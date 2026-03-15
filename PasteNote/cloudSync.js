// 腾讯云 COS SDK 需要在 manifest.json 中声明或通过 CDN 加载
// 这里假设 COS 已经通过 script 标签加载到全局

class CloudSync {
  constructor(config) {
    this.cos = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey
    });
    this.bucket = config.bucket;
    this.region = config.region;
    this.key = 'PasteNote/PasteNote.json';
  }

  async upload(data) {
    return new Promise((resolve, reject) => {
      this.cos.putObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: this.key,
        Body: JSON.stringify(data)
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  async download() {
    return new Promise((resolve, reject) => {
      this.cos.getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: this.key
      }, (err, data) => {
        if (err) {
          if (err.statusCode === 404) resolve(null);
          else reject(err);
        } else {
          try {
            const notes = JSON.parse(data.Body);
            resolve(notes);
          } catch (e) {
            reject(new Error('Invalid data format'));
          }
        }
      });
    });
  }
}