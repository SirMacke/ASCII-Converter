<template>
  <div>
    <h1>Image Upload</h1>
    <input type="file" accept="image/*" @change="handleFileChange" />
    <button @click="uploadImage" :disabled="!selectedFile">Upload</button>
    <!--<div v-if="uploadedImage">
      <img :src="uploadedImage" alt="Uploaded Image" />
      <p>{{ serverResponse }}</p>
    </div>-->
    <p>{{ serverResponse }}</p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      selectedFile: null,
      uploadedImage: null,
      serverResponse: null,
    };
  },
  methods: {
    handleFileChange(event) {
      this.selectedFile = event.target.files[0];
    },
    async uploadImage() {
      if (!this.selectedFile) return;

      const formData = new FormData();
      formData.append('image', this.selectedFile);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        console.log('response', response);

        if (response.ok) {
          const data = await response.json();
          //this.uploadedImage = data.imageUrl;
          this.serverResponse = data.text;
        } else {
          console.error('Image upload failed:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Image upload failed:', error);
      }
    },
  },
};
</script>