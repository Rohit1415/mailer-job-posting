// src/mailer/index.js
const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");
const fs = require("fs");

async function createTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // helps in some CI environments
    },
    connectionTimeout: 30 * 1000,
  });

  try {
    await transporter.verify();
    console.log("✅ SMTP verified");
  } catch (err) {
    console.warn("⚠️ SMTP verify warning:", err.message);
  }

  return transporter;
}

async function renderTemplate(templateFile, data) {
  const templatePath = path.join(__dirname, "templates", templateFile);
  return ejs.renderFile(templatePath, data);
}

/**
 * sendJobApplication - sends a single templated email
 * @param {Object} opts
 *   - to: string (required)
 *   - subject: string
 *   - templateData: object
 *   - attachments: array
 */
async function sendJobApplication({
  to,
  subject,
  templateData = {},
  attachments = [],
}) {
  if (!to) throw new Error("`to` is required");

  const transporter = await createTransporter();
  const html = await renderTemplate("job-application.ejs", templateData);

  // filter attachments if paths missing
  const finalAttachments = (attachments || []).filter((att) => {
    if (att.path) return fs.existsSync(att.path);
    return true;
  });

  const mailOptions = {
    from: `"${
      process.env.FROM_NAME || templateData.senderName || "Rohit Bhatu"
    }" <${process.env.FROM_EMAIL}>`,
    to,
    subject:
      subject || "Application for Frontend Engineer / React Developer Role",
    html,
    attachments: finalAttachments,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * sendBulkJobApplications - send to multiple recipients with batching, retries
 * @param {Array} recipients - [{ email, name, customFields }]
 * @param {Object} options - { templateData, attachments, batchSize, delayMs, maxRetries, retryDelayMs, subject }
 */
async function sendBulkJobApplications(recipients = [], options = {}) {
  const {
    templateData = {},
    attachments = [],
    batchSize = parseInt(process.env.BATCH_SIZE || "20", 10),
    delayMs = parseInt(process.env.DELAY_MS || "1500", 10),
    maxRetries = parseInt(process.env.MAX_RETRIES || "2", 10),
    retryDelayMs = parseInt(process.env.RETRY_DELAY_MS || "2000", 10),
    subject,
  } = options;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("recipients must be a non-empty array");
  }

  const results = [];
  const transporter = await createTransporter();

  // helper to send one with retries (uses transporter directly for efficiency)
  async function sendOne(recipient, attempt = 0) {
    try {
      const mergedTemplateData = Object.assign({}, templateData, {
        hiringManagerName: recipient.name || templateData.hiringManagerName,
        senderName: templateData.senderName,
        portfolioUrl: templateData.portfolioUrl,
        linkedInUrl: templateData.linkedInUrl,
        phone: templateData.phone,
        senderEmail: templateData.senderEmail,
      });

      const html = await ejs.renderFile(
        path.join(__dirname, "templates", "job-application.ejs"),
        mergedTemplateData
      );

      const mailOptions = {
        from: `"${
          process.env.FROM_NAME ||
          mergedTemplateData.senderName ||
          "Rohit Bhatu"
        }" <${process.env.FROM_EMAIL}>`,
        to: recipient.email,
        subject:
          subject || `Application for Frontend Engineer / React Developer Role`,
        html,
        attachments: (attachments || []).filter(
          (att) => !att.path || fs.existsSync(att.path)
        ),
      };

      const info = await transporter.sendMail(mailOptions);
      return { success: true, email: recipient.email, info };
    } catch (err) {
      if (attempt < maxRetries) {
        // wait and retry
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return sendOne(recipient, attempt + 1);
      }
      return {
        success: false,
        email: recipient.email,
        error: err.message || err,
      };
    }
  }

  // process in batches
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    // map to promises (concurrent within batch)
    const batchPromises = batch.map((recipient) => sendOne(recipient));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // delay between batches unless finished
    if (i + batchSize < recipients.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

// Export functions explicitly
module.exports = {
  sendJobApplication,
  sendBulkJobApplications,
};
