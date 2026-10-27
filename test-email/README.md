# Pravah dummy email

`pravah-test-email.eml` is a synthetic supplier email with a three-page PO/GRN/invoice PDF and a gate-entry PNG. The attachments are saved separately for direct upload on Invoice review. All names and amounts in the documents are test data.

To test the document flow now, upload the PDF and PNG together at http://localhost:5173/review. To test actual mailbox intake, first connect a mailbox in Settings > Integrations, then send this email's two attachments to that mailbox from your own email account. The `.eml` file is a local sample, not a sent message.

The invoice intentionally uses a higher rate and total than the PO, shorter payment terms, and 100 bags invoiced against 95 accepted on the GRN.
