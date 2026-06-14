/**
 * 生成扩展图标 PNG (16x16, 48x48, 128x128)
 * 纯 JS 生成，不依赖 canvas 模块
 * 使用 sharp（如果可用）或直接生成最小 PNG
 */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// 尝试用 sharp
try {
  var sharp = require('sharp');
  console.log('Using sharp for icon generation...');
  generateWithSharp(sharp);
} catch (e) {
  console.log('sharp not available, using pure JS PNG generation...');
  generatePurePNG();
}

function generateWithSharp(sharp) {
  // 用 SVG 作为源
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#764ba2"/>' +
    '</linearGradient></defs>' +
    '<rect width="128" height="128" rx="24" fill="url(#g)"/>' +
    '<text x="64" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="56" fill="white">AT</text>' +
    '</svg>';

  var sizes = [16, 48, 128];
  var done = 0;
  sizes.forEach(function(size) {
    sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, 'icon' + size + '.png'))
      .then(function(info) {
        console.log('Generated: icon' + size + '.png (' + info.size + ' bytes)');
        done++;
        if (done === sizes.length) console.log('Done!');
      })
      .catch(function(err) {
        console.error('Error generating icon' + size + '.png:', err.message);
        done++;
        if (done === sizes.length) console.log('Done (with errors)');
      });
  });
}

function generatePurePNG() {
  // 生成简单的渐变 PNG
  [16, 48, 128].forEach(function(size) {
    var pixels = Buffer.alloc(size * size * 4);

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var idx = (y * size + x) * 4;
        var t = (x + y) / (2 * size);

        // 渐变 #667eea -> #764ba2
        var r = Math.round(102 + t * (118 - 102));
        var g = Math.round(126 + t * (75 - 126));
        var b = Math.round(234 + t * (162 - 234));

        // 圆角裁剪
        var radius = size * 0.1875;
        var inRect = true;
        // 检查四个圆角
        var corners = [[radius, radius], [size - radius, radius], [radius, size - radius], [size - radius, size - radius]];
        for (var c = 0; c < 4; c++) {
          var cx = corners[c][0], cy = corners[c][1];
          if ((x < radius || x >= size - radius) && (y < radius || y >= size - radius)) {
            var dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > radius * radius) {
              inRect = false;
              break;
            }
          }
        }

        if (inRect) {
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = 255;
        } else {
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 0;
        }
      }
    }

    // 绘制 "AT" 文字（简单像素方式）
    // 对于 16x16 太小，只画大尺寸
    if (size >= 48) {
      drawText(pixels, size, 'AT', size >= 100 ? 0.4 : 0.35);
    }

    // 编码 PNG
    var png = encodePNG(pixels, size, size);
    var outPath = path.join(outDir, 'icon' + size + '.png');
    fs.writeFileSync(outPath, png);
    console.log('Generated: ' + outPath + ' (' + png.length + ' bytes)');
  });

  console.log('Done!');
}

function drawText(pixels, size, text, scale) {
  // 简单的 5x7 像素字体
  var font = {
    'A': [
      '01110',
      '10001',
      '10001',
      '11111',
      '10001',
      '10001',
      '10001'
    ],
    'T': [
      '11111',
      '00100',
      '00100',
      '00100',
      '00100',
      '00100',
      '00100'
    ]
  };

  var charW = 5, charH = 7;
  var pixelSize = Math.max(1, Math.round(size * scale / charH));
  var totalW = text.length * (charW + 1) * pixelSize - pixelSize;
  var totalH = charH * pixelSize;
  var startX = Math.round((size - totalW) / 2);
  var startY = Math.round((size - totalH) / 2);

  for (var ci = 0; ci < text.length; ci++) {
    var ch = font[text[ci]];
    if (!ch) continue;
    var offsetX = startX + ci * (charW + 1) * pixelSize;

    for (var row = 0; row < charH; row++) {
      for (var col = 0; col < charW; col++) {
        if (ch[row][col] === '1') {
          for (var py = 0; py < pixelSize; py++) {
            for (var px = 0; px < pixelSize; px++) {
              var x = offsetX + col * pixelSize + px;
              var y = startY + row * pixelSize + py;
              if (x >= 0 && x < size && y >= 0 && y < size) {
                var idx = (y * size + x) * 4;
                pixels[idx] = 255;
                pixels[idx + 1] = 255;
                pixels[idx + 2] = 255;
                pixels[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }
}

function encodePNG(pixels, width, height) {
  // PNG 文件格式
  var signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - 每行加 filter byte (0=none)
  var rawData = Buffer.alloc(height * (1 + width * 4));
  for (var y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  var compressed = zlib.deflateSync(rawData);

  // IEND
  var iend = Buffer.alloc(0);

  var chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend)
  ];

  return Buffer.concat([signature].concat(chunks));
}

function makeChunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var typeB = Buffer.from(type, 'ascii');
  var crcData = Buffer.concat([typeB, data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

function crc32(buf) {
  var table = [];
  for (var i = 0; i < 256; i++) {
    var c = i;
    for (var j = 0; j < 8; j++) {
      if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[i] = c;
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
