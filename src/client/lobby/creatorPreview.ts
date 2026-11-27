// Display the same unarmed model used for the player in the world.
import * as THREE from 'three';
import { PLAYER_ARCHETYPE, type CharLook } from '../../shared/packs';
import { makePed, PED_S } from '../render/pedMesh';

export class CreatorPreview {
  private renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-0.53, 0.53, 1.06, -1.06, 0.1, 12);
  private model?: THREE.Group;
  private turn = 0;

  constructor() {
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(96, 192);
    this.renderer.domElement.className = 'figure';
    this.camera.position.set(5, 1.4, 0);
    this.camera.lookAt(0, 0.96, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 2);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0xaba5a0, 1.6));
  }

  show(look: CharLook): HTMLCanvasElement {
    if (this.model) this.scene.remove(this.model);
    this.model = makePed(0, PLAYER_ARCHETYPE, null, look).root;
    this.model.scale.setScalar(1 / PED_S);
    this.scene.add(this.model);
    this.draw();
    return this.renderer.domElement;
  }

  rotate(step: number): void {
    this.turn = (this.turn + step + 8) % 8;
    this.draw();
  }

  private draw(): void {
    if (this.model) this.model.rotation.y = this.turn * Math.PI / 4;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
