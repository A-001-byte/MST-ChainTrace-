import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const ION = 0x58e1ff, EMBER = 0xff8a2a;
const BLOCKS = 18;

/** Draws the Bitcoin mark (a bold B with its four serif bars, tilted 14°) into a 2D context. */
function drawGlyph(g, cx, cy, size, fill) {
  g.save();
  g.translate(cx, cy); g.rotate(0.244);
  g.font = `700 ${size}px "Chakra Petch", "Arial Black", Arial, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  const m = g.measureText("B");
  const top = -m.actualBoundingBoxAscent / 2, bottom = m.actualBoundingBoxAscent / 2;
  const left = -m.actualBoundingBoxLeft;
  g.fillStyle = fill;
  g.fillText("B", 0, bottom);
  const w = size * 0.075, h = size * 0.15;
  for (const x of [left + size * 0.07, left + size * 0.24]) {
    g.fillRect(x, top - h * 0.8, w, h);
    g.fillRect(x, bottom - h * 0.2, w, h);
  }
  g.restore();
}

function coinFace() {
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(400, 360, 40, 512, 512, 520);
  grad.addColorStop(0, "#ffe0b0"); grad.addColorStop(0.4, "#ffa142"); grad.addColorStop(1, "#9c3f00");
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = "rgba(255,244,228,0.7)"; g.lineWidth = 12;
  g.beginPath(); g.arc(512, 512, 468, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "rgba(80,25,0,0.45)"; g.lineWidth = 4;
  g.beginPath(); g.arc(512, 512, 430, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 96; i++) {   // milled rim ticks
    const a = (i / 96) * Math.PI * 2;
    g.strokeStyle = i % 4 ? "rgba(80,25,0,0.35)" : "rgba(255,240,220,0.6)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(512 + Math.cos(a) * 440, 512 + Math.sin(a) * 440); g.lineTo(512 + Math.cos(a) * 458, 512 + Math.sin(a) * 458); g.stroke();
  }
  // engraved mark: a light lip offset down-right, the dark cut on top
  drawGlyph(g, 518, 518, 560, "rgba(255,236,210,0.75)");
  drawGlyph(g, 512, 512, 560, "#6e2a00");
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function glyphSprite() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "#ffb066"; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke();
  drawGlyph(g, 64, 64, 70, "#ffb066");
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dot() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.45)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Login backdrop: a machined Bitcoin, orbited by a ring of linked blocks with a
 * transaction pulse running around it, in a drifting field of particles and ₿ marks.
 * Pure decoration — nothing here is data. Static frame under reduced motion.
 */
export default function BitcoinBackdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const rm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x03050a, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03050a, 0.045);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    camera.position.set(0, 0, 11);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const rimIon = new THREE.PointLight(ION, 5, 0, 0); rimIon.position.set(-6, 3, 3); scene.add(rimIon);
    const rimEmber = new THREE.PointLight(EMBER, 3, 0, 0); rimEmber.position.set(6, -3, 4); scene.add(rimEmber);

    // --- the coin -------------------------------------------------------------
    const face = coinFace();
    const faceMat = new THREE.MeshStandardMaterial({ map: face, metalness: 0.6, roughness: 0.34, emissive: EMBER, emissiveMap: face, emissiveIntensity: 0.05 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xff9a3c, metalness: 0.95, roughness: 0.22, emissive: 0x3a1400 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 128, 1), [edgeMat, faceMat, faceMat]);
    coin.rotation.x = Math.PI / 2;
    const coinRig = new THREE.Group(); coinRig.add(coin); scene.add(coinRig);
    // Redraw once the display font is ready so the glyph uses Chakra Petch.
    document.fonts?.load('700 560px "Chakra Petch"').then(() => {
      const fresh = coinFace(); faceMat.map = fresh; faceMat.emissiveMap = fresh; faceMat.needsUpdate = true; face.dispose();
    }).catch(() => {});

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: EMBER, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(9, 9, 1); halo.position.z = -1.2; coinRig.add(halo);

    // --- ring of blocks: the chain ------------------------------------------------
    const ring = new THREE.Group(); ring.rotation.set(1.18, 0, 0.32); coinRig.add(ring);
    const R = 3.7;
    const boxGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const edgeGeo = new THREE.EdgesGeometry(boxGeo);
    const blocks = [];
    const ringPts = [];
    for (let i = 0; i < BLOCKS; i++) {
      const a = (i / BLOCKS) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
      ringPts.push(p.clone());
      const fill = new THREE.MeshBasicMaterial({ color: ION, transparent: true, opacity: 0.08 });
      const wire = new THREE.LineBasicMaterial({ color: ION, transparent: true, opacity: 0.85 });
      const b = new THREE.Group();
      b.add(new THREE.Mesh(boxGeo, fill), new THREE.LineSegments(edgeGeo, wire));
      b.position.copy(p); b.rotation.set(a, a * 2, 0);
      b.userData = { fill, wire, a, heat: 0 };
      ring.add(b); blocks.push(b);
    }
    const linkGeo = new THREE.BufferGeometry().setFromPoints([...ringPts, ringPts[0]]);
    ring.add(new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: ION, transparent: true, opacity: 0.28 })));
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pulse.scale.set(0.9, 0.9, 1); ring.add(pulse);

    // --- particle field ------------------------------------------------------------
    const N = 1600;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const cIon = new THREE.Color(ION), cEmber = new THREE.Color(EMBER), cDim = new THREE.Color(0x6b7da0);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34; pos[i * 3 + 1] = (Math.random() - 0.5) * 22; pos[i * 3 + 2] = (Math.random() - 0.5) * 24 - 4;
      const c = Math.random() < 0.18 ? cEmber : Math.random() < 0.5 ? cIon : cDim;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const field = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.07, map: dot(), vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(field);

    // --- drifting ₿ marks ------------------------------------------------------------
    const gTex = glyphSprite();
    const glyphs = Array.from({ length: 16 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, transparent: true, opacity: 0.12 + Math.random() * 0.22, depthWrite: false }));
      const k = 0.35 + Math.random() * 0.6; s.scale.set(k, k, 1);
      s.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 16, -3 - Math.random() * 10);
      s.userData.v = 0.004 + Math.random() * 0.01;
      scene.add(s); return s;
    });

    // --- post ------------------------------------------------------------------------
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.6, 0.78);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const size = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height); composer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      // keep the coin clear of the sign-in card: left of centre on wide screens, high on narrow
      const wide = width > 1100;
      coinRig.position.set(wide ? 1.3 : 0, wide ? 0 : 1.8, 0);
      coinRig.scale.setScalar(wide ? 0.85 : 0.75);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(el); size();

    const mouse = { x: 0, y: 0 };
    const onMove = (e) => { mouse.x = e.clientX / window.innerWidth - 0.5; mouse.y = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    const clock = new THREE.Clock();
    const frame = () => {
      const t = clock.getElapsedTime();
      coin.rotation.z = t * 0.55;                                    // spin about the coin's own axis
      coin.position.y = Math.sin(t * 0.8) * 0.12;                    // slow bob
      coinRig.rotation.x = Math.sin(t * 0.4) * 0.12 + mouse.y * 0.35;
      coinRig.rotation.y = mouse.x * 0.5;
      ring.rotation.y = t * 0.18;

      // the transaction pulse walks the ring; blocks it passes flare ember, then cool
      const ta = (t * 0.55) % (Math.PI * 2);
      pulse.position.set(Math.cos(ta) * R, 0, Math.sin(ta) * R);
      for (const b of blocks) {
        const d = Math.abs(((b.userData.a - ta + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        b.userData.heat = Math.max(b.userData.heat * 0.96, d < 0.12 ? 1 : 0);
        const h = b.userData.heat;
        b.userData.wire.color.setHex(ION).lerp(cEmber, h);
        b.userData.fill.color.setHex(ION).lerp(cEmber, h);
        b.userData.fill.opacity = 0.08 + h * 0.4;
        b.rotation.x += 0.004; b.rotation.y += 0.006;
      }

      const p = pGeo.attributes.position.array;
      for (let i = 1; i < p.length; i += 3) { p[i] += 0.006; if (p[i] > 11) p[i] = -11; }
      pGeo.attributes.position.needsUpdate = true;
      for (const s of glyphs) { s.position.y += s.userData.v; if (s.position.y > 9) s.position.y = -9; }

      camera.position.x += (mouse.x * 1.4 - camera.position.x) * 0.03;
      camera.position.y += (-mouse.y * 0.9 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);
      composer.render();
      if (!rm) raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose(); });
      });
      pmrem.dispose(); composer.dispose?.(); renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={ref} className="bg" aria-hidden="true" />;
}
