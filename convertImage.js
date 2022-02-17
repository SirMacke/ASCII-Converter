const fs = require('fs');
const Jimp = require('jimp');
const { cobRes, covertToASCII, delay } = require('./helperFunctions');

module.exports = async (variables) => {
  if (!fs.existsSync(`./images/${variables.imageFileName}.png`)) {
    Jimp.read(`./images/${variables.imageFileName}.jpg`, function (err, image) {
      if (err) console.log(err);
      else image.write(`./images/${variables.imageFileName}.png`);
    });
    await delay(2000);
  }

  await cobRes(fs.readFileSync(`./images/${variables.imageFileName}.png`), variables.asciiHeight, buffer => fs.writeFileSync(`./images/${variables.imageFileName}2.png`, buffer));
  await delay(500);

  await covertToASCII(fs.readFileSync(`./images/${variables.imageFileName}2.png`), variables.grayScaleBias, variables.darkOrLight);
}