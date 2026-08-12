#!/usr/bin/env node
/**
 * Single-File Web App Bundler
 *
 * Packs a web project directory into ONE self-contained .html file.
 * No dependencies, no network, no build step.
 *
 *   node generate-loader.js [dir] [options]
 *
 * See README.md for the full contract, including what this cannot do.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', '.svn', '.hg', '.DS_Store', 'Thumbs.db',
  '.cache', 'dist', 'build', '.env', '.env.local',
  'generate-loader.js', // the bundler is a build tool, not app content
  'loader.html',        // a bundle left by an earlier run, under any --out name
];

function parseArgs(argv) {
  const opts = {
    dir: null,
    out: 'loader.html',
    entry: null,
    title: null,
    exclude: [],
    quiet: false,
    encrypt: false,
    keyFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a === '--out' || a === '-o') {
      opts.out = argv[++i];
    } else if (a === '--entry' || a === '-e') {
      opts.entry = argv[++i];
    } else if (a === '--title' || a === '-t') {
      opts.title = argv[++i];
    } else if (a === '--exclude' || a === '-x') {
      opts.exclude.push(argv[++i]);
    } else if (a === '--quiet' || a === '-q') {
      opts.quiet = true;
    } else if (a === '--encrypt' || a === '-E') {
      opts.encrypt = true;
    } else if (a === '--key-file' || a === '-k') {
      opts.keyFile = argv[++i];
      opts.encrypt = true;
    } else if (a.startsWith('-')) {
      fatal('Unknown option: ' + a + '\nRun with --help for usage.');
    } else if (opts.dir === null) {
      opts.dir = a;
    } else {
      fatal('Unexpected argument: ' + a);
    }
  }

  // Default to the directory the user is standing in, NOT the script's own
  // directory. This is what makes `node ../generate-loader.js` work.
  opts.dir = path.resolve(opts.dir || process.cwd());
  return opts;
}

function usage() {
  console.log(`Single-File Web App Bundler

  node generate-loader.js [dir] [options]

  dir                  Project directory to bundle (default: current directory)

  -o, --out <file>     Output filename          (default: loader.html)
  -e, --entry <path>   Entry HTML, relative to dir
                       (default: shallowest index.html)
  -t, --title <text>   <title> of the output page
  -x, --exclude <pat>  Extra path to skip; repeatable. Matches any path
                       segment, or a path prefix.
  -q, --quiet          Only print the final summary
  -h, --help           Show this message

  -E, --encrypt        Encrypt the payload (AES-256-GCM). Generates a random
                       key, prints it, and gates the page behind a key form.
                       The key is NOT recoverable from the bundle.
  -k, --key-file <f>   Also write the key to a file (implies --encrypt).
                       Refused if <f> is inside the bundled directory.

  Always excluded: ${DEFAULT_EXCLUDES.join(', ')}, and the output file itself.`);
}

function fatal(msg) {
  console.error('\n  error: ' + msg + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Collect files
// ---------------------------------------------------------------------------

function collectFiles(root, excludes) {
  const files = [];

  function isExcluded(relPath) {
    const segments = relPath.split('/');
    return excludes.some(
      (pattern) => segments.includes(pattern) || relPath === pattern || relPath.startsWith(pattern + '/')
    );
  }

  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      fatal('Cannot read directory ' + dir + ': ' + e.message);
    }

    for (const entry of entries) {
      // Always forward slashes: this is a web path, not a filesystem path.
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (isExcluded(rel)) continue;

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push({ path: rel, bytes: fs.readFileSync(path.join(dir, entry.name)) });
      }
      // Symlinks and special files are skipped deliberately: following them can
      // escape the project root or loop forever.
    }
  }

  walk(root, '');
  return files;
}

function pickEntry(files, requested) {
  if (requested) {
    const want = requested.replace(/\\/g, '/').replace(/^\.\//, '');
    const hit = files.find((f) => f.path === want);
    if (!hit) {
      fatal(
        'Entry file not found in bundle: ' + want + '\n' +
        'HTML files available:\n  ' +
        (files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path).join('\n  ') || '(none)')
      );
    }
    return hit.path;
  }

  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path));
  if (htmlFiles.length === 0) fatal('No .html file found in ' + files.length + ' files. Nothing to use as an entry point.');

  const indexes = htmlFiles.filter((f) => /(^|\/)index\.html?$/i.test(f.path));
  const pool = indexes.length ? indexes : htmlFiles;

  // Shallowest wins; ties broken alphabetically so the result is deterministic.
  pool.sort((a, b) => {
    const depth = a.path.split('/').length - b.path.split('/').length;
    return depth !== 0 ? depth : a.path.localeCompare(b.path);
  });
  return pool[0].path;
}

// ---------------------------------------------------------------------------
// Container format
//
//   "SFB1" | uint32LE manifestLength | manifest JSON | concatenated file bytes
//
// The whole thing is deflate-raw'd, then base64'd once. Compressing across the
// concatenation (rather than per file) exploits redundancy between files, and
// base64ing last means the 33% inflation applies to compressed bytes only.
// ---------------------------------------------------------------------------

function buildContainer(files) {
  const manifest = [];
  let offset = 0;
  for (const f of files) {
    manifest.push({ p: f.path, o: offset, l: f.bytes.length });
    offset += f.bytes.length;
  }

  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.alloc(8);
  header.write('SFB1', 0, 'ascii');
  header.writeUInt32LE(manifestBuf.length, 4);

  const raw = Buffer.concat([header, manifestBuf, ...files.map((f) => f.bytes)]);
  return zlib.deflateRawSync(raw, { level: 9 });
}

// ---------------------------------------------------------------------------
// Encryption
//
// AES-256-GCM over the compressed container. Encrypting after compression is
// the correct order: ciphertext is indistinguishable from noise and would not
// compress at all.
//
// Output layout:  iv(12) | ciphertext | authTag(16)
//
// WebCrypto expects the tag appended to the ciphertext, which is why Node's
// separate getAuthTag() result is concatenated on the end rather than kept
// alongside. GCM is authenticated, so a wrong key fails the tag check and
// throws instead of yielding plausible-looking garbage — that is what makes
// "wrong key" reliably detectable in the browser.
// ---------------------------------------------------------------------------

function encryptContainer(compressed) {
  const key = crypto.randomBytes(32); // 256-bit, full entropy
  const iv = crypto.randomBytes(12);  // 96-bit nonce, the GCM standard size

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    payload: Buffer.concat([iv, ciphertext, authTag]),
    // base64url: no +, / or = to mangle when pasted into a URL or a shell.
    key: key.toString('base64url'),
  };
}

// ---------------------------------------------------------------------------
// Browser runtime
//
// Serialized via Function.prototype.toString(), so it is written as ordinary
// JavaScript here — no nested-template escaping, and editors treat it as code.
// It must be self-contained: it receives everything through its parameters.
// ---------------------------------------------------------------------------

function SFB_RUNTIME(PAYLOAD_B64, ENTRY_PATH, ENCRYPTED) {
  var statusEl = document.getElementById('sfb-status');

  function fail(message, detail) {
    var form = document.getElementById('sfb-keyform');
    if (form) form.style.display = 'none';
    if (statusEl) {
      statusEl.innerHTML =
        '<div class="sfb-err"><strong>Could not start the bundled app</strong>' +
        '<p>' + String(message) + '</p>' +
        (detail ? '<pre>' + String(detail) + '</pre>' : '') +
        '</div>';
    }
    console.error('[bundler] ' + message, detail || '');
  }

  var MIME = {
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
    map: 'application/json', txt: 'text/plain', csv: 'text/csv',
    xml: 'application/xml', svg: 'image/svg+xml', ico: 'image/x-icon',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
    wav: 'audio/wav', pdf: 'application/pdf', wasm: 'application/wasm',
  };

  function mimeFor(p) {
    var ext = p.split('.').pop().toLowerCase();
    return MIME[ext] || 'application/octet-stream';
  }

  // Normalize a URL reference into a bundle key: strip query/hash, resolve
  // "." and "..", drop any leading slash.
  function normalize(ref, baseDir) {
    if (!ref) return null;
    var s = String(ref).trim().replace(/[?#].*$/, '');
    if (!s) return null;
    // Anything with a scheme, or a protocol-relative URL, is external.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) || s.indexOf('//') === 0) return null;

    var absolute = s.charAt(0) === '/';
    var parts = (absolute || !baseDir ? s : baseDir + '/' + s).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  }

  function dirOf(p) {
    var i = p.lastIndexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  }

  function start(files) {
    // ---- file table -------------------------------------------------------
    var byPath = {};   // exact bundle path -> record
    var bySuffix = {}; // "a/b.json" and "b.json" -> record (ambiguous ones nulled)

    function addSuffix(key, rec) {
      if (Object.prototype.hasOwnProperty.call(bySuffix, key) && bySuffix[key] !== rec) {
        bySuffix[key] = null; // ambiguous: refuse to guess
      } else {
        bySuffix[key] = rec;
      }
    }

    for (var i = 0; i < files.length; i++) {
      var rec = files[i];
      rec.mime = mimeFor(rec.path);
      rec.blobUrl = null;
      byPath[rec.path] = rec;

      var segs = rec.path.split('/');
      for (var n = 1; n <= Math.min(segs.length, 3); n++) {
        addSuffix(segs.slice(segs.length - n).join('/'), rec);
      }
    }

    // Resolve a reference to a bundled file, or null if it isn't ours.
    function lookup(ref, baseDir) {
      var key = normalize(ref, baseDir);
      if (!key) return null;
      if (byPath[key]) return byPath[key];
      // Fall back to suffix matching. Projects are commonly bundled from a
      // parent directory, so "data/x.json" may live at "docs/data/x.json".
      if (bySuffix[key]) return bySuffix[key];
      var base = key.split('/').pop();
      if (bySuffix[base]) return bySuffix[base];
      return null;
    }

    function blobUrlFor(rec) {
      if (!rec.blobUrl) {
        rec.blobUrl = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
      }
      return rec.blobUrl;
    }

    function textOf(rec) {
      return new TextDecoder('utf-8').decode(rec.bytes);
    }

    // ---- rewrite static references ---------------------------------------
    // Runtime patching (below) cannot see markup the parser handles itself, so
    // src/href/srcset/url() are rewritten to blob: URLs before injection.

    function rewriteCss(css, baseDir) {
      return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (match, quote, ref) {
        var hit = lookup(ref, baseDir);
        return hit ? 'url(' + quote + blobUrlFor(hit) + quote + ')' : match;
      });
    }

    function rewriteSrcset(value, baseDir) {
      return value.split(',').map(function (candidate) {
        var bits = candidate.trim().split(/\s+/);
        var hit = lookup(bits[0], baseDir);
        if (hit) bits[0] = blobUrlFor(hit);
        return bits.join(' ');
      }).join(', ');
    }

    function rewriteHtml(html, baseDir) {
      // Attributes that name a resource.
      html = html.replace(
        /\b(src|href|poster|data)\s*=\s*(["'])([^"']*)\2/gi,
        function (match, attr, quote, ref) {
          var hit = lookup(ref, baseDir);
          return hit ? attr + '=' + quote + blobUrlFor(hit) + quote : match;
        }
      );

      html = html.replace(/\bsrcset\s*=\s*(["'])([^"']*)\1/gi, function (match, quote, value) {
        return 'srcset=' + quote + rewriteSrcset(value, baseDir) + quote;
      });

      // <style> blocks and style="" attributes.
      html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (match, body) {
        return match.replace(body, rewriteCss(body, baseDir));
      });
      html = html.replace(/\bstyle\s*=\s*(["'])([^"']*)\1/gi, function (match, quote, body) {
        return 'style=' + quote + rewriteCss(body, baseDir) + quote;
      });

      return html;
    }

    // CSS files are rewritten in place so their own url() references resolve
    // before they are turned into blobs.
    for (var j = 0; j < files.length; j++) {
      if (/\.css$/i.test(files[j].path)) {
        var css = rewriteCss(textOf(files[j]), dirOf(files[j].path));
        files[j].bytes = new TextEncoder().encode(css);
      }
    }

    // ---- ES module graph --------------------------------------------------
    // A module served from a blob: URL cannot resolve `import './lib.js'` —
    // blob: is not a hierarchical scheme, so the relative specifier throws.
    // The fix is to rewrite each specifier to the imported file's own blob URL.
    // That requires the dependency's blob to exist first, so modules are
    // processed depth-first: leaves get blobs, then their importers.
    var IMPORT_RE = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g;
    var isModule = function (rec) { return /\.(m?js)$/i.test(rec.path); };
    var moduleState = {}; // path -> 'active' | 'done'
    var cycles = [];

    function linkModule(rec) {
      if (moduleState[rec.path] === 'done') return;
      if (moduleState[rec.path] === 'active') { cycles.push(rec.path); return; }
      moduleState[rec.path] = 'active';

      var dir = dirOf(rec.path);
      var text = textOf(rec);

      // Dependencies first, so blobUrlFor below returns a linked module.
      text.replace(IMPORT_RE, function (match, keyword, quote, specifier) {
        var dep = lookup(specifier, dir);
        if (dep && isModule(dep)) linkModule(dep);
        return match;
      });

      var linked = text.replace(IMPORT_RE, function (match, keyword, quote, specifier) {
        var dep = lookup(specifier, dir);
        // Only rewrite what we actually carry; bare specifiers such as
        // 'react' are left for the import map or the network to resolve.
        return dep ? keyword + quote + blobUrlFor(dep) + quote : match;
      });

      if (linked !== text) rec.bytes = new TextEncoder().encode(linked);
      moduleState[rec.path] = 'done';
    }

    for (var k = 0; k < files.length; k++) {
      if (isModule(files[k])) linkModule(files[k]);
    }
    if (cycles.length) {
      console.warn(
        '[bundler] circular imports involving ' + cycles.join(', ') +
        ' — these modules may fail to load.'
      );
    }

    // ---- expose to the iframe --------------------------------------------
    // The iframe is same-origin (about:blank), so its shim reaches this
    // directly. Bytes are handed over without copying.
    window.__SFB__ = {
      lookup: lookup,
      blobUrl: blobUrlFor,
      rewriteMarkup: rewriteHtml,
      mimeFor: mimeFor,
      normalize: normalize,
      list: function () { return Object.keys(byPath); },
      read: function (p) { var r = lookup(p, ''); return r ? r.bytes : null; },
    };

    // ---- boot the entry document -----------------------------------------
    var entry = byPath[ENTRY_PATH] || lookup(ENTRY_PATH, '');
    if (!entry) return fail('Entry file missing from the bundle: ' + ENTRY_PATH);

    var baseDir = dirOf(entry.path);
    var doc = rewriteHtml(textOf(entry), baseDir);

    // The shim must run before any app script, so it is injected at the very
    // top of <head> (or the top of the document if there is no <head>).
    var shim =
      '<script>(' + SFB_SHIM.toString() + ')(' + JSON.stringify(baseDir) + ');<\/script>';

    if (/<head\b[^>]*>/i.test(doc)) {
      doc = doc.replace(/<head\b[^>]*>/i, function (m) { return m + shim; });
    } else if (/<html\b[^>]*>/i.test(doc)) {
      doc = doc.replace(/<html\b[^>]*>/i, function (m) { return m + shim; });
    } else {
      doc = shim + doc;
    }

    var frame = document.getElementById('sfb-frame');
    // about:blank inherits this page's origin, so history.pushState,
    // localStorage, cookies and same-origin XHR all behave normally.
    // (srcdoc gives an opaque origin and breaks all of them.)
    var idoc = frame.contentDocument;
    idoc.open();
    idoc.write(doc);
    idoc.close();

    document.getElementById('sfb-loading').style.display = 'none';
    frame.style.display = 'block';
  }

  // Runs inside the iframe. Intercepts requests the markup rewriter cannot see:
  // fetch(), XMLHttpRequest, and dynamically assigned element sources.
  function SFB_SHIM(BASE_DIR) {
    var FS = null;
    try { FS = parent.__SFB__; } catch (e) { /* cross-origin: leave unpatched */ }
    if (!FS) return;

    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      var hit = null;
      try { hit = FS.lookup(url, BASE_DIR); } catch (e) {}
      if (hit) {
        return Promise.resolve(new Response(hit.bytes.slice(), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': hit.mime, 'Content-Length': String(hit.bytes.length) },
        }));
      }
      return nativeFetch.apply(this, arguments);
    };

    var NativeXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      var xhr = new NativeXHR();
      var pending = null;

      var nativeOpen = xhr.open;
      xhr.open = function (method, url) {
        try { pending = FS.lookup(url, BASE_DIR); } catch (e) { pending = null; }
        if (pending) { this.__sfbUrl = url; return; }
        return nativeOpen.apply(xhr, arguments);
      };

      var nativeSend = xhr.send;
      xhr.send = function () {
        if (!pending) return nativeSend.apply(xhr, arguments);
        var hit = pending;
        setTimeout(function () {
          var text = new TextDecoder('utf-8').decode(hit.bytes);
          var body = xhr.responseType === 'arraybuffer' ? hit.bytes.buffer
                   : xhr.responseType === 'blob' ? new Blob([hit.bytes], { type: hit.mime })
                   : xhr.responseType === 'json' ? JSON.parse(text)
                   : text;
          try {
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
            Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: text, configurable: true });
            Object.defineProperty(xhr, 'response', { value: body, configurable: true });
          } catch (e) { /* some engines lock these down; events still fire */ }
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new Event('load'));
          xhr.dispatchEvent(new Event('loadend'));
        }, 0);
      };

      return xhr;
    }
    PatchedXHR.prototype = NativeXHR.prototype;
    PatchedXHR.UNSENT = 0; PatchedXHR.OPENED = 1; PatchedXHR.HEADERS_RECEIVED = 2;
    PatchedXHR.LOADING = 3; PatchedXHR.DONE = 4;
    window.XMLHttpRequest = PatchedXHR;

    function swap(value) {
      var hit = null;
      try { hit = FS.lookup(value, BASE_DIR); } catch (e) {}
      return hit ? FS.blobUrl(hit) : value;
    }

    // Elements whose source is assigned as a property (img.src = "...").
    [[window.HTMLImageElement, 'src'], [window.HTMLScriptElement, 'src'],
     [window.HTMLLinkElement, 'href'], [window.HTMLSourceElement, 'src'],
     [window.HTMLMediaElement, 'src'], [window.HTMLIFrameElement, 'src'],
     [window.HTMLObjectElement, 'data'], [window.HTMLTrackElement, 'src']]
      .forEach(function (pair) {
        var ctor = pair[0], prop = pair[1];
        if (!ctor) return;
        var descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
        if (!descriptor || !descriptor.set) return;
        Object.defineProperty(ctor.prototype, prop, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set: function (value) { descriptor.set.call(this, swap(value)); },
        });
      });

    // ...and as an attribute (el.setAttribute('src', '...')).
    var SRC_ATTRS = { src: 1, href: 1, poster: 1, data: 1 };
    var nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (SRC_ATTRS[String(name).toLowerCase()]) value = swap(value);
      return nativeSetAttribute.call(this, name, value);
    };

    // Markup built as a string. This is the common case for template-driven
    // rendering (container.innerHTML = items.map(...)), where the parser
    // creates the elements and no setter ever runs. Rewriting the string
    // before it is parsed avoids a failed request entirely.
    ['innerHTML', 'outerHTML'].forEach(function (prop) {
      var descriptor = Object.getOwnPropertyDescriptor(Element.prototype, prop);
      if (!descriptor || !descriptor.set) return;
      Object.defineProperty(Element.prototype, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function (value) {
          descriptor.set.call(this, FS.rewriteMarkup(String(value), BASE_DIR));
        },
      });
    });

    var nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, markup) {
      return nativeInsertAdjacentHTML.call(this, position, FS.rewriteMarkup(String(markup), BASE_DIR));
    };

    var nativeWrite = document.write;
    document.write = function () {
      var out = Array.prototype.map.call(arguments, function (chunk) {
        return FS.rewriteMarkup(String(chunk), BASE_DIR);
      });
      return nativeWrite.apply(document, out);
    };

    // Safety net for paths none of the above cover (createElement +
    // direct attribute mutation, framework-managed DOM, and so on).
    // Already-swapped blob: URLs resolve to null on lookup, so this settles.
    if (window.MutationObserver) {
      var fixElement = function (el) {
        if (!el || el.nodeType !== 1) return;
        ['src', 'href', 'poster', 'data'].forEach(function (attr) {
          var value = el.getAttribute && el.getAttribute(attr);
          if (!value) return;
          var swapped = swap(value);
          if (swapped !== value) nativeSetAttribute.call(el, attr, swapped);
        });
        if (el.querySelectorAll) {
          Array.prototype.forEach.call(el.querySelectorAll('[src],[href],[poster],[data]'), fixElement);
        }
      };
      new MutationObserver(function (records) {
        for (var r = 0; r < records.length; r++) {
          var added = records[r].addedNodes;
          for (var n = 0; n < added.length; n++) fixElement(added[n]);
          if (records[r].type === 'attributes') fixElement(records[r].target);
        }
      }).observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['src', 'href', 'poster', 'data'],
      });
    }
  }

  // --- decode, decrypt, inflate, unpack ------------------------------------

  function base64ToBytes(text) {
    var binary = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // compressed bytes -> parsed manifest -> hand off to start()
  function unpack(compressed) {
    return new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    )
      .arrayBuffer()
      .then(function (buffer) {
        var raw = new Uint8Array(buffer);
        var view = new DataView(buffer);

        var magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
        if (magic !== 'SFB1') throw new Error('bad container magic: ' + magic);

        var manifestLength = view.getUint32(4, true);
        var manifestJson = new TextDecoder('utf-8').decode(raw.subarray(8, 8 + manifestLength));
        var manifest = JSON.parse(manifestJson);
        var dataStart = 8 + manifestLength;

        start(manifest.map(function (item) {
          return {
            path: item.p,
            bytes: raw.subarray(dataStart + item.o, dataStart + item.o + item.l),
          };
        }));
      });
  }

  // Layout: iv(12) | ciphertext | authTag(16). WebCrypto wants the tag glued
  // to the ciphertext, so everything past the IV is passed through as one.
  function decrypt(packed, keyText) {
    var keyBytes;
    try {
      keyBytes = base64ToBytes(keyText.trim());
    } catch (e) {
      return Promise.reject(new Error('MALFORMED_KEY'));
    }
    if (keyBytes.length !== 32) return Promise.reject(new Error('MALFORMED_KEY'));

    return crypto.subtle
      .importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
      .then(function (cryptoKey) {
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: packed.subarray(0, 12) },
          cryptoKey,
          packed.subarray(12)
        );
      })
      .then(function (plaintext) { return new Uint8Array(plaintext); });
  }

  function showKeyForm(packed) {
    var form = document.getElementById('sfb-keyform');
    var input = document.getElementById('sfb-key');
    var button = document.getElementById('sfb-unlock');
    var error = document.getElementById('sfb-keyerror');

    document.getElementById('sfb-loading').style.display = 'none';
    form.style.display = 'flex';
    input.focus();

    function setError(message) {
      error.textContent = message || '';
      error.style.visibility = message ? 'visible' : 'hidden';
      if (message) { input.select(); input.focus(); }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (button.disabled) return;

      setError('');
      button.disabled = true;
      input.disabled = true;
      button.textContent = 'Decrypting…';

      decrypt(packed, input.value)
        .then(function (compressed) {
          form.style.display = 'none';
          document.getElementById('sfb-loading').style.display = 'flex';
          return unpack(compressed);
        })
        .catch(function (e) {
          button.disabled = false;
          input.disabled = false;
          button.textContent = 'Unlock';
          // GCM tag mismatch throws a bare OperationError with no message,
          // which is exactly the wrong-key case.
          setError(
            e && e.message === 'MALFORMED_KEY'
              ? 'That is not a valid key. Expected 43 characters.'
              : 'Incorrect key.'
          );
        });
    });
  }

  (function boot() {
    var packed;
    try {
      packed = base64ToBytes(PAYLOAD_B64);
    } catch (e) {
      return fail('The embedded payload is corrupt.', e.message);
    }

    if (typeof DecompressionStream === 'undefined') {
      return fail(
        'This browser lacks DecompressionStream, which the bundle needs to unpack itself.',
        'Requires Chrome/Edge 80+, Safari 16.4+, or Firefox 113+.'
      );
    }

    if (!ENCRYPTED) {
      return unpack(packed).catch(function (e) {
        fail('Could not unpack the bundle.', e && e.message);
      });
    }

    // crypto.subtle exists only in a secure context: https, localhost, or
    // file. Plain http on a LAN address will not have it.
    if (!window.crypto || !window.crypto.subtle) {
      return fail(
        'This bundle is encrypted, but the browser will not expose the Web Crypto API here.',
        'crypto.subtle requires a secure context. Serve the file over https://, ' +
        'or open it from http://localhost or file://.'
      );
    }

    showKeyForm(packed);
  })();
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function buildHtml(payloadB64, entryPath, title, encrypted) {
  const runtimeSource = SFB_RUNTIME.toString();

  const keyForm = !encrypted ? '' : `
<form id="sfb-keyform" autocomplete="off">
  <div class="sfb-lock" aria-hidden="true">&#128274;</div>
  <h1>This page is encrypted</h1>
  <p>Enter the key you were given to unlock it.</p>
  <input id="sfb-key" type="password" spellcheck="false" autocapitalize="off"
         autocorrect="off" aria-label="Decryption key" placeholder="Decryption key">
  <button id="sfb-unlock" type="submit">Unlock</button>
  <p id="sfb-keyerror" role="alert"></p>
</form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  #sfb-frame { display: none; width: 100%; height: 100%; border: 0; }
  #sfb-loading {
    display: flex; align-items: center; justify-content: center;
    height: 100%; gap: 14px; flex-direction: column;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #666; background: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    #sfb-loading { background: #16181c; color: #9aa4b2; }
  }
  .sfb-spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid rgba(128,128,128,.25); border-top-color: currentColor;
    animation: sfb-spin .8s linear infinite;
  }
  @keyframes sfb-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .sfb-spinner { animation-duration: 3s; } }
  .sfb-err {
    max-width: 44rem; padding: 1.5rem; text-align: left;
    font: 14px/1.6 system-ui, sans-serif; color: #b3261e;
  }
  .sfb-err pre {
    white-space: pre-wrap; background: rgba(128,128,128,.12);
    padding: .75rem; border-radius: 6px; font-size: 12px;
  }

  #sfb-keyform {
    display: none; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; gap: 4px; padding: 1.5rem;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fafafa; color: #1a1c20; text-align: center;
  }
  #sfb-keyform .sfb-lock { font-size: 34px; margin-bottom: 6px; }
  #sfb-keyform h1 { margin: 0; font-size: 17px; font-weight: 600; }
  #sfb-keyform p { margin: 2px 0 0; color: #6b7280; font-size: 13px; }
  #sfb-key {
    width: min(100%, 22rem); margin-top: 18px; padding: 11px 13px;
    font: 14px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: inherit; background: #fff;
    border: 1px solid #d3d7de; border-radius: 8px;
  }
  #sfb-key:focus {
    outline: none; border-color: #6b7cff;
    box-shadow: 0 0 0 3px rgba(107,124,255,.25);
  }
  #sfb-unlock {
    width: min(100%, 22rem); margin-top: 9px; padding: 11px 13px;
    font: 600 14px/1 system-ui, sans-serif; color: #fff;
    background: #3b4ce0; border: 0; border-radius: 8px; cursor: pointer;
  }
  #sfb-unlock:hover:not(:disabled) { background: #3242c8; }
  #sfb-unlock:disabled { opacity: .6; cursor: default; }
  #sfb-keyerror {
    visibility: hidden; margin-top: 12px; min-height: 1.2em;
    color: #c0392b; font-size: 13px;
  }
  @media (prefers-color-scheme: dark) {
    #sfb-keyform { background: #16181c; color: #e6e9ef; }
    #sfb-keyform p { color: #98a2b3; }
    #sfb-key { background: #1e2127; border-color: #333a45; }
    #sfb-keyerror { color: #ff8a80; }
  }
</style>
</head>
<body>
<div id="sfb-status"><div id="sfb-loading"><div class="sfb-spinner"></div><p>Unpacking&hellip;</p></div></div>${keyForm}
<iframe id="sfb-frame" title="${escapeHtml(title)}"></iframe>
<script>
(${runtimeSource})(${JSON.stringify(payloadB64)}, ${JSON.stringify(entryPath)}, ${encrypted ? 'true' : 'false'});
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  if (!fs.existsSync(opts.dir) || !fs.statSync(opts.dir).isDirectory()) {
    fatal('Not a directory: ' + opts.dir);
  }

  const outPath = path.resolve(opts.dir, opts.out);
  const relativeOut = path.relative(opts.dir, outPath).replace(/\\/g, '/');
  // Outside the project dir the relative form is a wall of "../" — show the
  // absolute path instead. Inside, the relative name is also the exclude key.
  const isInsideDir = !relativeOut.startsWith('../') && !path.isAbsolute(relativeOut);
  const outName = isInsideDir ? relativeOut : outPath;

  // Excluding the output file is what stops each run from swallowing the
  // previous run's bundle and doubling in size.
  const excludes = DEFAULT_EXCLUDES.concat(opts.exclude);
  if (isInsideDir) excludes.push(relativeOut);

  // A key file inside the bundled directory would be swept into the next
  // build — shipping the decryption key inside the thing it decrypts, with
  // no visible sign anything is wrong. Refuse rather than warn.
  let keyFilePath = null;
  if (opts.keyFile) {
    keyFilePath = path.resolve(process.cwd(), opts.keyFile);
    const insideBundle = path.relative(opts.dir, keyFilePath);
    if (insideBundle && !insideBundle.startsWith('..') && !path.isAbsolute(insideBundle)) {
      fatal(
        'Refusing to write the key to ' + opts.keyFile + '\n' +
        '  That path is inside the directory being bundled, so the next build\n' +
        '  would embed the key in the encrypted bundle itself.\n' +
        '  Write it somewhere outside ' + opts.dir
      );
    }
  }

  log('\n  Bundling ' + opts.dir);

  const files = collectFiles(opts.dir, excludes);
  if (files.length === 0) fatal('No files to bundle in ' + opts.dir + ' (everything was excluded).');

  const entryPath = pickEntry(files, opts.entry);
  const sourceBytes = files.reduce((n, f) => n + f.bytes.length, 0);

  log('  ' + files.length + ' files, ' + formatSize(sourceBytes));
  log('  entry: ' + entryPath);

  const compressed = buildContainer(files);

  let payload = compressed;
  let key = null;
  if (opts.encrypt) {
    const result = encryptContainer(compressed);
    payload = result.payload;
    key = result.key;
  }

  const title = opts.title || path.basename(opts.dir);
  const html = buildHtml(payload.toString('base64'), entryPath, title, opts.encrypt);

  fs.writeFileSync(outPath, html, 'utf8');

  if (key && opts.keyFile) {
    fs.writeFileSync(keyFilePath, key + '\n', 'utf8');
  }

  const outSize = Buffer.byteLength(html);
  const ratio = sourceBytes > 0 ? Math.round((outSize / sourceBytes) * 100) : 0;

  log('');
  console.log('  ' + outName + '  ' + formatSize(outSize) + '  (' + ratio + '% of source)');

  if (key) {
    // Printed unconditionally, even under --quiet: losing this line means
    // losing the bundle. There is no recovery path.
    console.log('\n  encrypted with AES-256-GCM. key:\n');
    console.log('      ' + key + '\n');
    if (opts.keyFile) console.log('  also written to ' + path.relative(process.cwd(), keyFilePath).replace(/\\/g, '/'));
    console.log('  Store it now — it is not derivable from the bundle, and');
    console.log('  without it the contents are unrecoverable.');
  }

  if (outSize > 20 * 1024 * 1024) {
    console.log(
      '\n  warning: bundles over ~20 MB are slow to parse and can exhaust memory\n' +
      '  on mobile browsers. Consider --exclude for large assets.'
    );
  }

  log('\n  Open it over http:// or https:// — file:// also works for most apps.');
  if (key) {
    log('  Encrypted bundles additionally need a secure context for crypto.subtle:');
    log('  https://, http://localhost, or file:// — plain http:// on a LAN IP will not do.');
  }
  log('');
}

main();
