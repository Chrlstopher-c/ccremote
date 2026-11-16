// Responsabilité : la caméra de la vue station — toute la station tient à l'écran au départ ; on la fait glisser au
// doigt ou à la souris, on zoome à la molette ou en pinçant (deux doigts), sans jamais sortir de l'image.
import Phaser from 'phaser';

export function activerGlisserZoomer(scene: Phaser.Scene, largeur: number, hauteur: number): void {
  const cam = scene.cameras.main;
  cam.setBounds(0, 0, largeur, hauteur);
  const ajuste = Math.max(scene.scale.width / largeur, scene.scale.height / hauteur); // la carte couvre tout l'écran
  const min = ajuste;
  const max = ajuste * 4;
  cam.setZoom(ajuste).centerOn(largeur / 2, hauteur / 2);
  scene.input.addPointer(1);
  let pince = 0;
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    const [a, b] = [scene.input.pointer1, scene.input.pointer2];
    if (a?.isDown && b?.isDown) {
      const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (pince) cam.setZoom(Phaser.Math.Clamp(cam.zoom * (d / pince), min, max));
      pince = d;
      return;
    }
    pince = 0;
    if (!p.isDown) return;
    cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
    cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
  });
  scene.input.on('pointerup', () => {
    pince = 0;
  });
  scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), min, max));
  });
}
