const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");
const fs = require("fs");

function getEnv(name, fallback) {
  return process.env[name] || fallback;
}

async function createTransporter() {
  const host = getEnv("SMTP_HOST", "smtp.gmail.com");
  const port = parseInt(getEnv("SMTP_PORT", "465"), 10);
  const secure = getEnv("SMTP_SECURE", "") === "true" ? true : port === 465;
  const pool = getEnv("SMTP_POOL", "true") === "true";
  const authUser = process.env.SMTP_USER;
  const authPass = process.env.SMTP_PASS;
  if (!authUser || !authPass) throw new Error("SMTP credentials missing");
  const transporter = nodemailer.createTransport({
    pool,
    host,
    port,
    secure,
    auth: { user: authUser, pass: authPass },
    tls: {
      rejectUnauthorized: getEnv("SMTP_REJECT_UNAUTHORIZED", "true") === "true",
    },
    connectionTimeout: parseInt(getEnv("SMTP_CONN_TIMEOUT", "30000"), 10),
    greetingTimeout: parseInt(getEnv("SMTP_GREETING_TIMEOUT", "30000"), 10),
  });
  try {
    await transporter.verify();
  } catch (e) {}
  return transporter;
}

async function renderTemplate(templateFile, data) {
  const templatePath = path.join(__dirname, "templates", templateFile);
  return ejs.renderFile(templatePath, data);
}

async function sendJobApplication({
  to,
  subject,
  templateData = {},
  attachments = [],
  dryRun = false,
}) {
  if (!to) throw new Error("to is required");
  const fromEmail = process.env.FROM_EMAIL;
  if (!fromEmail) throw new Error("FROM_EMAIL missing");
  const transporter = await createTransporter();
  const html = await renderTemplate("job-application.ejs", templateData);
  const finalAttachments = (attachments || []).filter((att) =>
    att.path ? fs.existsSync(att.path) : true
  );
  const fromName = getEnv(
    "FROM_NAME",
    templateData.senderName || "Rohit Bhatu"
  );
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject:
      subject || "Application for Frontend Engineer / React Developer Role",
    html,
    attachments: finalAttachments,
  };
  if (dryRun || getEnv("DRY_RUN", "false") === "true")
    return { success: true, dryRun: true, mailOptions };
  const info = await transporter.sendMail(mailOptions);
  return info;
}

async function sendBulkJobApplications(recipients = [], options = {}) {
  const templateData = options.templateData || {};
  const attachments = options.attachments || [];
  const batchSize = parseInt(
    getEnv("BATCH_SIZE", String(options.batchSize || 20)),
    10
  );
  const delayMs = parseInt(
    getEnv("DELAY_MS", String(options.delayMs || 1500)),
    10
  );
  const maxRetries = parseInt(
    getEnv("MAX_RETRIES", String(options.maxRetries || 2)),
    10
  );
  const retryDelayMs = parseInt(
    getEnv("RETRY_DELAY_MS", String(options.retryDelayMs || 2000)),
    10
  );
  const subject = options.subject;
  const perRecipientDelayMs = parseInt(
    getEnv(
      "PER_RECIPIENT_DELAY_MS",
      String(options.perRecipientDelayMs || 200)
    ),
    10
  );
  const dryRun = options.dryRun || getEnv("DRY_RUN", "false") === "true";
  const maxTotal = parseInt(getEnv("MAX_TOTAL_RECIPIENTS", "1000"), 10);
  if (!Array.isArray(recipients) || recipients.length === 0)
    throw new Error("recipients must be a non-empty array");
  if (recipients.length > maxTotal)
    throw new Error("recipients exceed max allowed");
  const results = [];
  const transporter = await createTransporter();

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
        from: `"${getEnv(
          "FROM_NAME",
          mergedTemplateData.senderName || "Rohit Bhatu"
        )}" <${process.env.FROM_EMAIL}>`,
        to: recipient.email,
        subject:
          subject || "Application for Frontend Engineer / React Developer Role",
        html,
        attachments: (attachments || []).filter(
          (att) => !att.path || fs.existsSync(att.path)
        ),
      };
      if (dryRun)
        return {
          success: true,
          dryRun: true,
          email: recipient.email,
          mailOptions,
        };
      const info = await transporter.sendMail(mailOptions);
      return { success: true, email: recipient.email, info };
    } catch (err) {
      if (attempt < maxRetries) {
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

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((recipient) => sendOne(recipient))
    );
    results.push(...batchResults);
    if (i + batchSize < recipients.length)
      await new Promise((r) => setTimeout(r, delayMs));
    if (perRecipientDelayMs > 0)
      await new Promise((r) => setTimeout(r, perRecipientDelayMs));
  }

  return results;
}

module.exports = { sendJobApplication, sendBulkJobApplications };
