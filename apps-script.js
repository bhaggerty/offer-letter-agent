const TEMPLATE_ID      = "1docqIMZDk7SkhCtCDZN46EU7NdYd2IGuq9vM4KjAMg4";
const SECRET_KEY       = "xK9mP2qL8nR4tY7w";
const OFFERS_FOLDER_ID = "1XmUhromZyovH63FJU_DGKUVDmhp-22d9";

function testDriveAccess() {
  const folder = DriveApp.getFolderById(OFFERS_FOLDER_ID);
  const template = DriveApp.getFileById(TEMPLATE_ID);
  Logger.log("Folder: " + folder.getName());
  Logger.log("Template: " + template.getName());
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.secretKey !== SECRET_KEY) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    if (payload.action === 'uploadSignedPdf') {
      return jsonResponse(uploadSignedPdf(payload));
    }

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

  // Create candidate folder in private offers directory
  const offersFolder = DriveApp.getFolderById(OFFERS_FOLDER_ID);
  const candidateFolder = offersFolder.createFolder(firstName + " " + lastName);

  // Copy template into candidate folder
  const templateFile = DriveApp.getFileById(TEMPLATE_ID);
  const newFile = templateFile.makeCopy("Offer Letter - " + firstName + " " + lastName, candidateFolder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // Replace all placeholders
  body.replaceText("{{DATE}}",          new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  body.replaceText("{{FirstName}}",     firstName      || "");
  body.replaceText("{{LastName}}",      lastName       || "");
  body.replaceText("{{JobTitle}}",      jobTitle       || "");
  body.replaceText("{{Department}}",    department     || "");
  body.replaceText("{{ManagerName}}",   managerName    || "");
  body.replaceText("{{StartDate}}",     startDate      || "");
  body.replaceText("{{BaseSalary}}",    baseSalary     || "");
  body.replaceText("{{SigningBonus}}",  signingBonus   || "N/A");
  body.replaceText("{{Shares}}",        equity         || "N/A");
  body.replaceText("{{EmploymentType}}",employmentType || "");
  body.replaceText("{{WorkLocation}}",  workLocation   || "");

  doc.saveAndClose();

  // Export as PDF and save to candidate folder
  const docFile = DriveApp.getFileById(newFile.getId());
  const pdfBlob = docFile.getAs("application/pdf");
  pdfBlob.setName("Offer Letter - " + firstName + " " + lastName + ".pdf");
  const pdfFile = candidateFolder.createFile(pdfBlob);

  return {
    docId:     newFile.getId(),
    docUrl:    newFile.getUrl(),
    pdfId:     pdfFile.getId(),
    pdfUrl:    pdfFile.getUrl(),
    folderId:  candidateFolder.getId(),
    folderUrl: candidateFolder.getUrl(),
    pdfBase64: Utilities.base64Encode(pdfBlob.getBytes()),
  };
}

function uploadSignedPdf(data) {
  const { folderId, fileName, pdfBase64 } = data;

  const folder = DriveApp.getFolderById(folderId);
  const pdfBytes = Utilities.base64Decode(pdfBase64);
  const blob = Utilities.newBlob(pdfBytes, 'application/pdf', fileName);
  const file = folder.createFile(blob);

  return {
    success: true,
    fileId:  file.getId(),
    fileUrl: file.getUrl(),
  };
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
