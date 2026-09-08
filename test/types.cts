import QRSal = require('qr-sal');
const image: QRSal.PixelImage = { width: 100, height: 100, data: new Uint8Array(10000) };
const text: string = QRSal.scan(image).codes[0].text;
void text;
