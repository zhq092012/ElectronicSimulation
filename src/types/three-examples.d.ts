declare module "three/examples/jsm/loaders/GLTFLoader" {
  import { Loader } from "three";
  export class GLTFLoader extends Loader {
    constructor(manager?: any);
    load(url: string, onLoad: (gltf: any) => void, onProgress?: any, onError?: (error: Error) => void): void;
    parse(data: ArrayBuffer | string, path: string, onLoad: (gltf: any) => void, onError?: (error: Error) => void): void;
  }
  export default GLTFLoader;
}

declare module "three/examples/jsm/controls/OrbitControls" {
  import { Camera, Vector3 } from "three";
  export class OrbitControls {
    constructor(object: Camera | any, domElement?: HTMLElement);
    update(): void;
    dispose(): void;
    target: Vector3;
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    enablePan: boolean;
    enableZoom: boolean;
    enableRotate: boolean;
    minDistance?: number;
    maxDistance?: number;
    minPolarAngle?: number;
    maxPolarAngle?: number;
    getPolarAngle(): number;
    getAzimuthalAngle(): number;
    addEventListener(type: string, listener: (event: any) => void): void;
  }
  export default OrbitControls;
}
