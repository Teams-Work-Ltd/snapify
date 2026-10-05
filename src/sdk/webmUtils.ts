import * as EBML from "ts-ebml";

/**
 * Injects seekable cue metadata into a recorded WebM blob using ts-ebml.
 */
export async function makeSeekableWebm(
  inputBlob: Blob,
  durationSeconds: number
): Promise<Blob> {
  return new Promise((resolve) => {
    try {
      const reader = new EBML.Reader();
      const decoder = new EBML.Decoder();
      const tools = EBML.tools;

      const fileReader = new FileReader();
      fileReader.onload = function () {
        if (!this.result || typeof this.result === "string") {
          resolve(inputBlob);
          return;
        }

        try {
          const ebmlElms = decoder.decode(this.result);
          ebmlElms.forEach(function (element) {
            reader.read(element);
          });
          reader.stop();

          const refinedMetadataBuf = tools.makeMetadataSeekable(
            reader.metadatas,
            Math.max(1, durationSeconds) * 1000,
            reader.cues
          );

          const body = this.result.slice(reader.metadataSize);
          const newBlob = new Blob([refinedMetadataBuf, body], {
            type: "video/webm",
          });

          resolve(newBlob);
        } catch (err) {
          console.warn("Error creating seekable metadata for WebM, falling back to raw blob:", err);
          resolve(inputBlob);
        }
      };

      fileReader.onerror = () => {
        resolve(inputBlob);
      };

      fileReader.readAsArrayBuffer(inputBlob);
    } catch {
      resolve(inputBlob);
    }
  });
}
