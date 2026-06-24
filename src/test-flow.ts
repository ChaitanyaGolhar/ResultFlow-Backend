import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import * as xlsx from 'xlsx';

const API_URL = 'http://localhost:4000/api/v1';

async function createDummyFiles() {
  const tempDir = path.join(__dirname, '../storage/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Create dummy PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(tempDir, 'template.pdf');
  fs.writeFileSync(pdfPath, pdfBytes);

  // Create dummy Excel
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet([
    { "Roll No": "101", "Name": "Alice", "Score": 95 },
    { "Roll No": "102", "Name": "Bob", "Score": 88 }
  ]);
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  const excelPath = path.join(tempDir, 'data.xlsx');
  xlsx.writeFile(wb, excelPath);

  return { pdfPath, excelPath };
}

async function runTest() {
  console.log('--- Starting Integration Test Flow ---');

  try {
    const { pdfPath, excelPath } = await createDummyFiles();
    console.log('✅ Created dummy files');

    // 1. Register / Login
    const email = `testuser_${Date.now()}@example.com`;
    let res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "Test User", email, password: "Password@123" })
    });
    
    let json: any = await res.json();
    if (!json.success) throw new Error('Registration failed: ' + JSON.stringify(json));
    const token = json.data.accessToken;
    console.log('✅ User registered successfully');

    // Helper for auth headers
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // 2. Upload Template
    const pdfBlob = new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' });
    const templateFormData = new FormData();
    templateFormData.append('file', pdfBlob, 'template.pdf');
    templateFormData.append('name', 'Test Certificate');

    res = await fetch(`${API_URL}/templates`, {
      method: 'POST',
      headers: { ...authHeaders },
      body: templateFormData as any
    });
    json = await res.json();
    if (!json.success) throw new Error('Template upload failed: ' + JSON.stringify(json));
    const templateId = json.data.template.id;
    console.log(`✅ Template uploaded successfully (ID: ${templateId})`);

    // 3. Set Template Fields
    res = await fetch(`${API_URL}/templates/${templateId}/fields`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: [
          { fieldKey: "studentName", label: "Student Name", x: 100, y: 500, width: 200, height: 20 },
          { fieldKey: "score", label: "Score", x: 100, y: 400, width: 50, height: 20 }
        ]
      })
    });
    json = await res.json();
    if (!json.success) throw new Error('Setting fields failed: ' + JSON.stringify(json));
    console.log('✅ Template fields saved');

    // 4. Upload Data
    const excelBlob = new Blob([fs.readFileSync(excelPath)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dataFormData = new FormData();
    dataFormData.append('file', excelBlob, 'data.xlsx');

    res = await fetch(`${API_URL}/data/upload`, {
      method: 'POST',
      headers: { ...authHeaders },
      body: dataFormData as any
    });
    json = await res.json();
    if (!json.success) throw new Error('Data upload failed: ' + JSON.stringify(json));
    const uploadId = json.data.uploadId;
    console.log(`✅ Data file uploaded (Upload ID: ${uploadId})`);

    // 5. Create Job
    const columnMapping = {
      "Roll No": "rollNumber",
      "Name": "studentName",
      "Score": "score"
    };

    res = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, uploadId, columnMapping })
    });
    json = await res.json();
    if (!json.success) throw new Error('Job creation failed: ' + JSON.stringify(json));
    const jobId = json.data.job.id;
    console.log(`✅ Job enqueued successfully (ID: ${jobId})`);

    // 6. Poll Job Status
    let status = 'PENDING';
    console.log('⏳ Polling job status...');
    while (status === 'PENDING' || status === 'PROCESSING') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      res = await fetch(`${API_URL}/jobs/${jobId}`, { headers: authHeaders });
      json = await res.json();
      status = json.data.job.status;
      console.log(`   Status: ${status} (Processed: ${json.data.job.processedRows}/${json.data.job.totalRows})`);
    }

    if (status === 'FAILED') {
      throw new Error('Job failed processing on the worker side!');
    }

    console.log('✅ PDF Generation complete!');
    console.log(`✅ ZIP file is ready at: ${json.data.job.zipFileUrl}`);

    console.log('🎉 All routes tested successfully!');

  } catch (error) {
    console.error('❌ Test flow failed:', error);
  }
}

runTest();
