# Single-File Web App Bundler

Convert any web project into a single self-contained HTML file with an embedded ZIP and automatic extraction.

## Quick Start

### 1. Copy the script to your project folder:
```bash
cp generate-loader.js /path/to/your/project/
```

### 2. Run it:
```bash
cd /path/to/your/project
node generate-loader.js
```

### 3. That's it!
- Creates `loader.html` - a single file containing your entire project
- Host it on a web server (requires `http://localhost` or `https://`)
- Open in browser and it extracts and runs your app

---

## How It Works

The script:
1. **Zips** your entire project folder
2. **Encodes to base64** for embedding
3. **Creates HTML** with:
   - Embedded ZIP data
   - JSZip library (from CDN)
   - Extraction script
   - Automatic loading into iframe

When opened:
- JavaScript extracts ZIP in memory
- Loads `index.html` from extracted files
- Maps all files (images, JSON, CSS, JS)
- Serves from memory via blobs

---

## Requirements

- **Node.js** (for running the script)
- **Web Server** (to test - `http://localhost` or `https://`)
  - Python: `python -m http.server 8000`
  - Node: `npx http-server`

---

## Output

- **loader.html** - Single file, ready to deploy
- Size: Original ZIP + 113 KB overhead
- Works offline once loaded
- No external dependencies needed

---

## Example

See `test-project/` for a complete working example (Digital Garden portfolio).

### Run the example:
```bash
cd test-project
node ../generate-loader.js
```

---

## Limitations

- Requires **HTTPS** or **localhost** for full functionality
- Service Worker features (resource interception) work on web servers only
- Works best with single-page applications (SPA)
- Large projects (>50 MB) may be slow to extract

---

## Files

- `generate-loader.js` - The bundler script
- `loader.html` - Generated single-file app (example)
- `test-project/` - Example project (Digital Garden)

---

**Created with ❤️ for building portable web applications**
