#!/usr/bin/env node
/**
 * Generate a single-file HTML loader that embeds the entire project as a ZIP
 * Usage: node generate-loader.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create ZIP file
console.log('Creating ZIP...');
try {
  execSync('powershell -Command "Compress-Archive -Path . -DestinationPath ../page-encryptor.zip -Force"', {
    cwd: __dirname,
    stdio: 'pipe'
  });
  console.log('✓ ZIP created');
} catch (e) {
  console.error('ZIP creation failed. Make sure you\'re on Windows with PowerShell');
  process.exit(1);
}

// Read ZIP and convert to base64
console.log('Converting to base64...');
const zipPath = path.join(__dirname, '..', 'page-encryptor.zip');
const zipBytes = fs.readFileSync(zipPath);
const b64 = Buffer.from(zipBytes).toString('base64');
console.log(`✓ ZIP size: ${(zipBytes.length / 1024).toFixed(1)} KB`);
console.log(`✓ Base64 size: ${(b64.length / 1024).toFixed(1)} KB`);

// Generate loader HTML
console.log('Generating loader.html...');
const html = `<!DOCTYPE html>
<html>
<head>
    <title>ZIP Loader</title>
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        #loader { display: flex; align-items: center; justify-content: center; height: 100vh; background: #f5f5f5; flex-direction: column; gap: 20px; }
        .spinner { border: 4px solid #ddd; border-top: 4px solid #2d5016; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        #content { display: none; width: 100%; height: 100%; }
        iframe { width: 100%; height: 100%; border: none; }
    </style>
</head>
<body>
    <div id="loader"><div class="spinner"></div><p>Extracting and loading...</p></div>
    <div id="content"><iframe id="frame"></iframe></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"><\/script>
    <script>
        const B64 = '${b64}';

        async function extract() {
            try {
                const bytes = new Uint8Array(atob(B64).split('').map(c => c.charCodeAt(0)));
                const zip = new JSZip();
                const extracted = await zip.loadAsync(bytes);

                let indexFile = null;
                extracted.forEach((path, file) => {
                    if (path.endsWith('index.html') && !path.includes('node_modules')) {
                        indexFile = file;
                    }
                });

                if (!indexFile) throw new Error('index.html not found');

                let html = await indexFile.async('string');

                // Extract images and create blob URLs map
                const imageMap = {};
                extracted.forEach((path, file) => {
                    if (path.match(/\\.(jpg|jpeg|png|gif|svg|webp)$/i)) {
                        imageMap[path] = file;
                    }
                });

                console.log('Found ' + Object.keys(imageMap).length + ' images');

                // Extract each image and replace in HTML
                for (const [imagePath, imageFile] of Object.entries(imageMap)) {
                    const imageData = await imageFile.async('arraybuffer');
                    const mimeType = getMimeType(imagePath);
                    const blob = new Blob([imageData], { type: mimeType });
                    const blobUrl = URL.createObjectURL(blob);

                    // Replace full path (handles both backslash and forward slash)
                    html = html.split(imagePath).join(blobUrl);

                    // Also try normalized version
                    const normalized = imagePath.replace(/\\\\\\\\/g, '/');
                    if (normalized !== imagePath) {
                        html = html.split(normalized).join(blobUrl);
                    }

                    console.log('Replaced: ' + imagePath);
                }

                // Load into iframe
                const iframe = document.getElementById('frame');
                iframe.srcdoc = html;

                document.getElementById('loader').style.display = 'none';
                document.getElementById('content').style.display = 'block';

                console.log('Page loaded successfully');
            } catch (e) {
                document.getElementById('loader').innerHTML = '<p style="color:red">Error: ' + e.message + '<\/p>';
                console.error('Error:', e);
            }
        }

        function getMimeType(path) {
            const ext = path.split('.').pop().toLowerCase();
            const types = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                webp: 'image/webp'
            };
            return types[ext] || 'application/octet-stream';
        }

        extract();
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'loader.html'), html);
console.log('✓ loader.html created');

// Clean up ZIP
fs.unlinkSync(zipPath);
console.log('✓ Cleaned up temporary ZIP');

console.log('\n✅ Done! Open loader.html to view your project.');
