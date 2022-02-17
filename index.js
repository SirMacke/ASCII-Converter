const fs = require('fs');
const PNG = require('pngjs').PNG;
const stream = require('stream');
const Jimp = require('jimp');
const variables = require('./variables.json');

(async () => {
  if (!fs.existsSync(`./images/${variables.imageFileName}.png`)) {
    Jimp.read(`./images/${variables.imageFileName}.jpg`, function (err, image) {
      if (err) console.log(err);
      else image.write(`./images/${variables.imageFileName}.png`);
    });
    await delay(1000);
  }

  await cobRes(fs.readFileSync(`./images/${variables.imageFileName}.png`), variables.asciiHeight, buffer => fs.writeFileSync(`./images/${variables.imageFileName}2.png`, buffer));
  await delay(500);

  await covertToASCII(fs.readFileSync(`./images/${variables.imageFileName}2.png`), variables.grayScaleBias, variables.darkOrLight);
})();


function covertToASCII(iBuf, spaces, blackWhite) {
  let scale = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'.";
  //let scale = 'Wwli:,. ';
  for (let i = 0; i < spaces; i++) scale += ' ';

  b2s(iBuf)
  .pipe(new PNG({
    colorType: 6
  }))
  .on('parsed', function() {
    for (let i = 0; i < this.height; i += 2) {
      let rowStr = '';
      for (let j = 0; j < this.width * 4; j += 4) {
        let pixelIndex = (j + this.width * i * 4);
        let pixelBrightness = (this.data[pixelIndex] + this.data[pixelIndex + 1] + this.data[pixelIndex + 2]) / 3;
        if (blackWhite) {
          let characterIndex = Math.round(mapRange(pixelBrightness, 255, 0, 0, scale.length - 1));
          rowStr += scale[characterIndex];
        } else {
          let characterIndex = Math.round(mapRange(pixelBrightness, 0, 255, 0, scale.length - 1));
          rowStr += scale[characterIndex];
        }
      }
      console.log(rowStr);
    }
  });
}


async function cobRes(iBuf, height, cb) {
  console.log(iBuf)
  b2s(iBuf)
  .pipe(new PNG({
    filterType: -1
  }))
  .on('parsed', async function() {
    let nh = height;
    let nw = Math.round(nh * this.width / this.height);
    let f = resize(this, nw, nh);

    sbuff(f.pack(), b => {
      cb(b);
    })
  })


  function resize(srcPng, width, height) {
    let rez = new PNG({
      width: width,
      height: height
    });
    for (let i = 0; i < width; i++) {
      let tx = i / width;
      let ssx = Math.floor(tx * srcPng.width);
      for(let j = 0; j < height; j++) {
        let ty = j / height;
        let ssy = Math.floor(ty * srcPng.height);
        let indexO = (ssx + srcPng.width * ssy) * 4;
        let indexC = (i + width * j) * 4;
        let rgbaO = [
          srcPng.data[indexO],
          srcPng.data[indexO + 1],
          srcPng.data[indexO + 2],
          srcPng.data[indexO + 3]
        ];
        rez.data[indexC] = rgbaO[0];
        rez.data[indexC + 1] = rgbaO[1];
        rez.data[indexC + 2] = rgbaO[2];
        rez.data[indexC + 3] = rgbaO[3];
      }
    }
    return rez;
  }
  
  function sbuff(stream, cb) {
    let bufs = []
    let pk = stream;
    pk.on('data', (d) => {
      bufs.push(d);
    });
    pk.on('end', () => {
      let buff = Buffer.concat(bufs);
      cb(buff);
    });
  }
}

function b2s(b) {
  let str = new stream.Readable();
  str.push(b);
  str.push(null);
  return str;
}

function mapRange(value, low1, high1, low2, high2) {
  return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

function delay(time) {
  return new Promise(function(resolve) { 
      setTimeout(resolve, time)
  });
}