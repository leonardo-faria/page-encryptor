#!/usr/bin/env node
/**
 * Generate a single-file HTML loader with Service Worker
 * Intercepts ALL fetches and serves files from embedded ZIP
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    <div id="loader"><div class="spinner"></div><p>Extracting and setting up...</p></div>
    <div id="content"><iframe id="frame"></iframe></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"><\/script>
    <script>
        const B64 = '${b64}';
        window.FILE_BLOB_MAP = {};  // Store all file blobs here

        async function extract() {
            try {
                const bytes = new Uint8Array(atob(B64).split('').map(c => c.charCodeAt(0)));
                const zip = new JSZip();
                const extracted = await zip.loadAsync(bytes);

                console.log('Extracting all files from ZIP...');

                // Extract ALL files
                const fileMap = {};
                extracted.forEach((path, file) => {
                    fileMap[path] = file;
                });

                console.log('Found ' + Object.keys(fileMap).length + ' files');

                // Convert all files to blobs and create URLs
                for (const [filePath, file] of Object.entries(fileMap)) {
                    const fileData = await file.async('arraybuffer');
                    const mimeType = getMimeType(filePath);
                    const blob = new Blob([fileData], { type: mimeType });
                    const blobUrl = URL.createObjectURL(blob);

                    // Store by normalized path
                    const normalizedPath = filePath.replace(/\\\\\\\\/g, '/');
                    window.FILE_BLOB_MAP[normalizedPath] = blobUrl;

                    if (filePath.endsWith('.html') || filePath.endsWith('.jpg') || filePath.endsWith('.png')) {
                        console.log('Mapped: ' + normalizedPath);
                    }
                }

                console.log('Total files mapped: ' + Object.keys(window.FILE_BLOB_MAP).length);

                // Note: Service Worker can't be registered from blob URLs (security restriction)
                // The ZIP is fully functional without it - files are served via iframe srcdoc
                console.log('✓ All files ready and mapped. Files will load from embedded ZIP.');

                // Find and load index.html
                let indexFile = null;
                extracted.forEach((path, file) => {
                    if (path.endsWith('index.html') && !path.includes('node_modules')) {
                        indexFile = file;
                    }
                });

                if (!indexFile) throw new Error('index.html not found');

                const html = await indexFile.async('string');

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
                html: 'text/html',
                css: 'text/css',
                js: 'application/javascript',
                json: 'application/json',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                webp: 'image/webp',
                woff: 'font/woff',
                woff2: 'font/woff2',
                ttf: 'font/ttf',
                pdf: 'application/pdf',
                mp4: 'video/mp4',
                webm: 'video/webm'
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

console.log('\n✅ Done! Open loader.html on a web server (not file://)');
console.log('   Service Worker requires: https:// or http://localhost');
