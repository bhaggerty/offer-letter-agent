const TEMPLATE_ID      = "1docqIMZDk7SkhCtCDZN46EU7NdYd2IGuq9vM4KjAMg4";
const SECRET_KEY       = "REPLACE_WITH_YOUR_SECRET_KEY";
const OFFERS_FOLDER_ID = "REPLACE_WITH_YOUR_OFFERS_FOLDER_ID";

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.secretKey !== SECRET_KEY) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    // Route to correct action
    if (payload.action === 'uploadSignedPdf') {
      return jsonResponse(uploadSignedPdf(payload));
    }

    // Default action — generate offer letter
    const result = generateOfferLetter(payload);
    return jsonResponse({ success: true, ...result });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function generateOfferLetter(data) {
  const {
    firstName, lastName, candidateEmail, jobTitle, department,
    managerName, startDate, baseSalary, signingBonus, equity,
    employmentType, workLocation,
  } = data;

  // Create candidate folder
  const offersFolder = DriveApp.getFolderById(OFFERS_FOLDER_ID);
  const candidateFolder = offersFolder.createFolder(`${firstName} ${lastName}`);

  // Copy template into candidate folder
  const templateFile = DriveApp.getFileById(TEMPLATE_ID);
  const newFile = templateFile.makeCopy(`Offer Letter - ${firstName} ${lastName}`, candidateFolder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // Replace placeholders
  body.replaceText("{{DATE}}",          new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  body.replaceText("{{FirstName}}",      firstName      || "");
  body.replaceText("{{LastName}}",       lastName       || "");
  body.replaceText("{{JobTitle}}",       jobTitle       || "");
  body.replaceText("{{Department}}",     department     || "");
  body.replaceText("{{ManagerName}}",    managerName    || "");
  body.replaceText("{{StartDate}}",      startDate      || "");
  body.replaceText("{{BaseSalary}}",     baseSalary     || "");
  body.replaceText("{{SigningBonus}}",   signingBonus   || "N/A");
  body.replaceText("{{Shares}}",         equity         || "N/A");
  body.replaceText("{{EmploymentType}}", employmentType || "");
  body.replaceText("{{WorkLocation}}",   workLocation   || "");

  doc.saveAndClose();

  // Export as PDF
  const docFile = DriveApp.getFileById(newFile.getId());
  const pdfBlob = docFile.getAs("application/pdf");
  pdfBlob.setName(`Offer Letter - ${firstName} ${lastName}.pdf`);
  const pdfFile = candidateFolder.createFile(pdfBlob);

  return {
    docId:      newFile.getId(),
    docUrl:     newFile.getUrl(),
    pdfId:      pdfFile.getId(),
    pdfUrl:     pdfFile.getUrl(),
    folderId:   candidateFolder.getId(),
    folderUrl:  candidateFolder.getUrl(),
    pdfBase64:  Utilities.base64Encode(pdfBlob.getBytes()),
  };
}

function uploadSignedPdf(data) {
  const { folderId, fileName, pdfBase64 } = data;

  const folder = DriveApp.getFolderById(folderId);
  const pdfBytes = Utilities.base64Decode(pdfBase64);
  const blob = Utilities.newBlob(pdfBytes, 'application/pdf', fileName);
  const file = folder.createFile(blob);

  return {
    success:  true,
    fileId:   file.getId(),
    fileUrl:  file.getUrl(),
  };
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
