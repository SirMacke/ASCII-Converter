import fs from 'fs';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  console.log('event', event)

  const contentType = body['content-type'];
  console.log('contentType', contentType)
  if (!contentType.includes('multipart/form-data')) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid content type. Expecting multipart/form-data.',
    };
  }

  // Parse the multipart/form-data
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)[1];
  const parts = body.split(`--${boundary}`);

  // Find the part containing the uploaded image
  let imageDataPart;
  for (const part of parts) {
    if (part.includes('filename=')) {
      imageDataPart = part;
      break;
    }
  }

  if (!imageDataPart) {
    return {
      ok: false,
      status: 400,
      error: 'No image file uploaded.',
    };
  }

  // Extract the image data
  const fileNameMatch = imageDataPart.match(/filename="([^"]+)"/i);
  const fileName = fileNameMatch ? fileNameMatch[1] : 'image.png';
  const imageDataStartIndex = imageDataPart.indexOf('\r\n\r\n') + 4;
  const imageData = imageDataPart.substring(imageDataStartIndex);

  // Write the image data to a file
  const imagePath = `./server/temp/${fileName}`;
  fs.writeFileSync(imagePath, imageData, 'binary');

  return {
    ok: true,
    status: 200,
    text: 'Image uploaded successfully!',
  };
});
