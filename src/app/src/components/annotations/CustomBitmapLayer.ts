import * as L from "leaflet";
import _ from "lodash";
import _noop from "lodash/noop";

/**
 * Custom Leaflet layer that extends Polygon layer
 * by exposing a `.getBitmap()` method for exporting bitmap of drawn polygon.
 * 
 * When the layer draws a polygon to canvas,
 * it stores a Path2D object which can be used to create an offscreen canvas
 * which in turn can be used for exporting bitmap
 * 
 * It works by monkey patching the renderer's canvas context to spy on the path methods.
 */

type CustomBitmapLayer = typeof L.Polygon & {
  getBitmap: (padding?: number) => Bitmap | null;
}

class Bitmap {
  x: number;
  y: number;
  width: number;
  height: number;
  private _offscreen: OffscreenCanvas;

  constructor(offscreen: OffscreenCanvas, x: number, y: number) {
    this._offscreen = offscreen;
    this.x = x;
    this.y = y;
    this.width = offscreen.width;
    this.height = offscreen.height;
  }

  getImageBitmap() {
    return this._offscreen.transferToImageBitmap();
  }

  getImageData() {
    return this._offscreen.getContext('2d')!.getImageData(0, 0, this.width, this.height);
  }

  getImageUrl() {
    return this._offscreen.convertToBlob().then(blob => URL.createObjectURL(blob));
  }
}

const CustomBitmapLayer = L.Polygon.extend({
  _path: new Path2D(),
  _pathBbox: [Infinity, Infinity, -Infinity, -Infinity],
  _updatePath() {
    if (!(this._renderer instanceof L.Canvas)) {
      this._renderer._updatePoly(this, true);
      return;
    }

    const path = new Path2D();
    const pathBbox = [Infinity, Infinity, -Infinity, -Infinity];
    const ctx = this._renderer._ctx as CanvasRenderingContext2D;
    const proxy = new Proxy(ctx, {
      get: (target, prop) => {
        if (prop === 'moveTo' || prop === 'lineTo') {
          return (x: number, y: number) => {
            pathBbox[0] = Math.min(pathBbox[0], x);
            pathBbox[1] = Math.min(pathBbox[1], y);
            pathBbox[2] = Math.max(pathBbox[2], x);
            pathBbox[3] = Math.max(pathBbox[3], y);
            path[prop as 'moveTo' | 'lineTo'](x, y);
          };
        } else if (prop === 'closePath') {
          return () => path.closePath();
        } else if (prop === 'stroke') {
          return () => ctx.stroke(path);
          // return _noop;
        } else if (prop === 'fill') {
          return (fillRule: CanvasFillRule) => ctx.fill(path, fillRule);
          // return _noop;
        }
        const member = target[prop as keyof CanvasRenderingContext2D];
        return typeof member === 'function' ? member.bind(target) : member;
      },
      set: (target, prop, value) => {
        (target as any)[prop] = value;
        return true;
      }
    });
    this._path = path;
    this._pathBbox = pathBbox;
    this._renderer._ctx = proxy;
    this._renderer._updatePoly(this, true);
    // const bitmap = this.getBitmap();
    // if (bitmap) {
    //   ctx.drawImage(bitmap.getImageBitmap(), bitmap.x, bitmap.y);
    // }
    this._renderer._ctx = ctx;
  },
  _createOffscreenCanvas(x: number, y: number, width: number, height: number) {
    const path = this._path;
    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d') as unknown as CanvasRenderingContext2D;
    ctx.translate(-x, -y);
    const proxy = new Proxy(ctx, {
      get: (target, prop) => {
        if (prop === 'fill') {
          return (fillRule: CanvasFillRule) => target.fill(path, fillRule);
        } else if (prop === 'stroke') {
          return () => target.stroke(path);
        } else {
          const member = target[prop as keyof CanvasRenderingContext2D];
          return typeof member === 'function' ? member.bind(target) : member;
        }
      },
      set: (target, prop, value) => {
        (target as any)[prop] = value;
        return true;
      }
    });
    this._renderer._fillStroke(proxy, this);
    return offscreen;
  },
  getBitmap(padding = 5) {
    let [xmin, ymin, xmax, ymax] = this._pathBbox;
    if (xmin >= xmax || ymin >= ymax) return null;
    xmin = Math.floor(xmin) - padding;
    ymin = Math.floor(ymin) - padding;
    xmax = Math.ceil(xmax) + padding;
    ymax = Math.ceil(ymax) + padding;
    const offscreen = this._createOffscreenCanvas(xmin, ymin, xmax - xmin, ymax - ymin);
    return new Bitmap(offscreen, this._pathBbox[0], this._pathBbox[1]);
  }
}) as unknown as CustomBitmapLayer;

export function createCustomBitmapLayer(vertices: L.LatLng[], options: L.PolylineOptions) {
  return new CustomBitmapLayer(vertices, options);
}

export default CustomBitmapLayer;
