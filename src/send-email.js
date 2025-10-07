// src/send-email.js
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { sendJobApplication, sendBulkJobApplications } = require("./mailer");

function parseRecipientsFromTxt(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

(async () => {
  try {
    // base template data
    const templateData = {
      hiringManagerName: "Hiring Manager",
      senderName: "Rohit Bhatu",
      currentRole: "Team Lead & Senior Frontend Engineer",
      experienceYears: 3,
      teamSize: 10,
      currentCtc: "₹4.8 LPA",
      expectedCtc: "₹8 LPA",
      noticePeriod: "10 days (flexible)",
      portfolioUrl: process.env.PORTFOLIO_URL,
      linkedInUrl: process.env.LINKEDIN_URL,
      phone: process.env.SENDER_PHONE,
      senderEmail: process.env.FROM_EMAIL,
      githubUrl: process.env.GITHUB_URL || "",
      resumeUrl: process.env.RESUME_URL || "",
    };

    // resume (optional)
    const attachments = [];
    const resumePath = path.resolve("./src/assets/rohit-bhatu-resume.pdf");
    if (fs.existsSync(resumePath)) {
      attachments.push({
        path: resumePath,
        filename: "Rohit-Bhatu-Resume.pdf",
      });
    }

    // recipients
    const recipientsFile = process.env.RECIPIENTS_FILE;
    if (!fs.existsSync(recipientsFile)) {
      console.error(`❌ Recipients file not found: ${recipientsFile}`);
      process.exit(1);
    }

    const recipients = parseRecipientsFromTxt(recipientsFile);
    if (!recipients.length) {
      console.error("❌ No recipients found in recipients.txt");
      process.exit(1);
    }

    console.log(`📨 Sending to ${recipients.length} recipients...`);

    const results = await sendBulkJobApplications(recipients, {
      templateData,
      attachments,
      subject: "Application for Frontend Engineer / React Developer Role",
    });

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    console.log(`\n✅ Successfully sent: ${successCount}`);
    if (failCount > 0) {
      console.warn(`⚠️ Failed: ${failCount}`);
      console.table(
        results
          .filter((r) => !r.success)
          .map((r) => ({ email: r.email, error: r.error }))
      );
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ Error sending emails:", err);
    process.exit(1);
  }
})();
