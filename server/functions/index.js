const convertImage = require('./convertImage');
const convertVideo = require('./convertVideo');
const variables = require('./variables.json');

(async () => {
  if (variables.typeOfConversion == 'image') {
    await convertImage(variables);
  } else if (variables.typeOfConversion == 'video') {
    await convertVideo(variables);
  }
})();