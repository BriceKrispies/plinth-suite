// Put a baked image into a 2D canvas element (its backing store sized to the image). No three.js here: the Plat
// uses it before and after the GPU chunk has loaded.

export const paintImage = (canvas: HTMLCanvasElement, img: ImageData): void => {
  if (canvas.width !== img.width) canvas.width = img.width;
  if (canvas.height !== img.height) canvas.height = img.height;
  canvas.getContext("2d")?.putImageData(img, 0, 0);
};
