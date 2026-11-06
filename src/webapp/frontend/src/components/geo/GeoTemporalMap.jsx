import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { animate, useReducedMotion } from "motion/react";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import { centroidFor, jitterFor } from "../../lib/countryCentroids";
import { activityBandFrom, bandLonRange } from "../../lib/regionAnchors";
import { CHART_COLORS as C } from "../../lib/chartColors";

const DEG = Math.PI / 180;
const R = 1;
const DIST_MIN = 1.7, DIST_MAX = 6, DIST_HOME = 3.9;
// jitterFor() works in pixels of the old 1000×500 equirectangular map; converted to degrees here
const OLD_W = 1000, OLD_H = 500, JITTER_PX = 11;
const ION = new THREE.Color(C.VIOLET), EMBER = new THREE.Color(C.EMBER);

/** lat/lon -> point on the sphere. Matches SphereGeometry's own phi/theta layout. */
function toVec(lat, lon, r = R) {
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

let dotTex = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.3, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

/** Land as a field of dots: rasterise the land polygons, then keep the sphere points that land on ink. */
function landDots() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const geo = feature(landTopo, landTopo.objects.land);
  const geoms = geo.type === "FeatureCollection" ? geo.features.map((f) => f.geometry) : [geo.geometry];
  g.fillStyle = "#fff";
  for (const gm of geoms) {
    const polys = gm.type === "MultiPolygon" ? gm.coordinates : [gm.coordinates];
    for (const poly of polys) {
      g.beginPath();
      for (const ring of poly) ring.forEach(([lon, lat], i) => { const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.fill("evenodd");
    }
  }
  const px = g.getImageData(0, 0, W, H).data;
  const pts = [];
  const N = 22000, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
    const lat = Math.asin(y) / DEG;
    const lon = ((Math.atan2(Math.sin(th) * rad, Math.cos(th) * rad) / DEG) + 540) % 360 - 180;
    const x = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W)), yy = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    if (px[(yy * W + x) * 4] > 128) pts.push(toVec(lat, lon, R * 1.002));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Arc from the claimed country up and over to the activity band's anchor. */
function arcCurve(a, b) {
  const lift = R + 0.12 + a.angleTo(b) * 0.32;
  const c1 = a.clone().lerp(b, 0.25).normalize().multiplyScalar(lift);
  const c2 = a.clone().lerp(b, 0.75).normalize().multiplyScalar(lift);
  return new THREE.CubicBezierCurve3(a, c1, c2, b);
}

/**
 * Interactive globe of flagged wallets by CLAIMED country.
 *
 * Same logic as the flat map it replaced: each wallet sits at its claimed country's centroid,
 * deterministically jittered; an arc runs to the timezone band the detector says its activity
 * actually fits; selecting a wallet shades that band and frames both ends. Drag orbits, wheel
 * zooms, double-click resets. The globe drifts until touched; reduced motion stills it.
 */
export default function GeoTemporalMap({ points, selectedId, onSelect }) {
  const rm = useReducedMotion();
  const wrapRef = useRef(null);
  const sceneRef = useRef(null);
  const labelRefs = useRef(new Map());
  const [hover, setHover] = useState(null);
  const selectRef = useRef(onSelect);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);

  const plotted = useMemo(() => (points ?? []).map((p) => {
    const c = centroidFor(p.claimedCountry);
    if (!c) return null;
    const { dx, dy } = jitterFor(p.nodeId, JITTER_PX);
    const lat = c.lat - dy * (180 / OLD_H), lon = c.lon + dx * (360 / OLD_W);
    const band = activityBandFrom(p.reason);
    return { ...p, lat, lon, countryName: c.name, band };
  }).filter(Boolean), [points]);

  const byCountry = useMemo(() => {
    const m = new Map();
    for (const p of plotted) {
      const c = centroidFor(p.claimedCountry);
      const e = m.get(p.claimedCountry) ?? { code: p.claimedCountry, lat: c.lat, lon: c.lon, n: 0 };
      e.n += 1; m.set(p.claimedCountry, e);
    }
    return [...m.values()];
  }, [plotted]);

  const selected = plotted.find((p) => p.nodeId === selectedId) ?? null;

  // --- build the scene once per data set -----------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.prepend(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
    camera.position.copy(toVec(32, -35, DIST_HOME));   // Atlantic: claims (Americas) and bands (Europe/Asia) both in view
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.7;
    controls.minDistance = DIST_MIN; controls.maxDistance = DIST_MAX;
    controls.autoRotate = !rm; controls.autoRotateSpeed = 0.35;

    // body, atmosphere, land, graticule
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.995, 64, 64), new THREE.MeshBasicMaterial({ color: 0x050c1a })));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.14, 64, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying vec3 vN; void main(){ float i = pow(0.68 - dot(vN, vec3(0.0,0.0,1.0)), 3.2); gl_FragColor = vec4(0.35,0.85,1.0,1.0) * i; }",
    })));
    scene.add(new THREE.Points(landDots(), new THREE.PointsMaterial({ color: 0x6fb2ff, size: 0.018, map: dot(), transparent: true, opacity: 1, depthWrite: false })));
    const gratMat = new THREE.LineBasicMaterial({ color: 0x15355a, transparent: true, opacity: 0.55 });
    for (let lon = -180; lon < 180; lon += 30) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 61 }, (_, i) => toVec(-90 + i * 3, lon, R * 1.001))), gratMat));
    }
    for (const lat of [-60, -30, 0, 30, 60]) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 121 }, (_, i) => toVec(lat, -180 + i * 3, R * 1.001))), gratMat));
    }

    // wallets: spike + glowing head + an invisible, generous hit sphere
    const wallets = new Map();
    const hits = [];
    const glow = dot();
    for (const p of plotted) {
      const base = toVec(p.lat, p.lon, R);
      const tip = toVec(p.lat, p.lon, R * 1.07);
      const spikeMat = new THREE.LineBasicMaterial({ color: ION, transparent: true, opacity: 0.85 });
      const spike = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, tip]), spikeMat);
      const headMat = new THREE.SpriteMaterial({ map: glow, color: ION, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const head = new THREE.Sprite(headMat); head.position.copy(tip); head.scale.setScalar(0.05);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.copy(tip); hit.userData.nodeId = p.nodeId;
      scene.add(spike, head, hit); hits.push(hit);

      let arc = null;
      if (p.band) {
        const curve = arcCurve(base, toVec(p.band.lat, p.band.lon, R));
        const pts = curve.getPoints(80);
        const cols = new Float32Array(pts.length * 3);
        pts.forEach((_, i) => { const c = ION.clone().lerp(EMBER, i / (pts.length - 1)); cols.set([c.r, c.g, c.b], i * 3); });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
        const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 });
        const pulseMat = new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const pulse = new THREE.Sprite(pulseMat); pulse.scale.setScalar(0.045);
        scene.add(new THREE.Line(geo, lineMat), pulse);
        arc = { curve, lineMat, pulse, pulseMat, phase: Math.random() };
      }
      wallets.set(p.nodeId, { p, base, spikeMat, headMat, head, arc });
    }

    // selection furniture: the shaded timezone band, its anchor, and a ping on the wallet
    const band = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 24, 48, 0, 15 * DEG),
      new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    const bandEdgeMat = new THREE.LineBasicMaterial({ color: EMBER, transparent: true, opacity: 0.7 });
    const bandEdges = new THREE.Group();
    const anchor = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.026, 40), new THREE.MeshBasicMaterial({ color: EMBER, side: THREE.DoubleSide, transparent: true }));
    const ping = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 40), new THREE.MeshBasicMaterial({ color: ION, side: THREE.DoubleSide, transparent: true }));
    band.visible = bandEdges.visible = anchor.visible = ping.visible = false;
    scene.add(band, bandEdges, anchor, ping);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.35));
    composer.addPass(new OutputPass());

    const size = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height); composer.setSize(width, height);
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(el); size();

    // labels are plain DOM, moved each frame, faded out on the far side of the globe
    const tmp = new THREE.Vector3();
    const placeLabel = (node, v) => {
      if (!node) return;
      if (!v) { node.style.opacity = "0"; return; }
      const facing = v.clone().normalize().dot(camera.position.clone().normalize());
      tmp.copy(v).project(camera);
      node.style.transform = `translate(${((tmp.x + 1) / 2) * el.clientWidth + 10}px, ${((1 - tmp.y) / 2) * el.clientHeight - 10}px)`;
      node.style.opacity = facing > 0.2 ? String(Math.min(1, (facing - 0.2) * 4) * (node.dataset.dim === "1" ? 0.3 : 1)) : "0";
    };

    let raf = 0;
    const clock = new THREE.Clock();
    const frame = () => {
      const t = clock.getElapsedTime();
      controls.update();
      for (const w of wallets.values()) {
        if (w.arc) w.arc.pulse.position.copy(w.arc.curve.getPoint(rm ? 0.5 : (t * 0.28 + w.arc.phase) % 1));
      }
      if (ping.visible && !rm) {
        const u = (t * 1.4) % 1;
        ping.scale.setScalar(1 + u * 2.4); ping.material.opacity = 1 - u;
      }
      for (const c of byCountry) placeLabel(labelRefs.current.get(c.code), toVec(c.lat, c.lon, R * 1.02));
      placeLabel(labelRefs.current.get("__band"), sceneRef.current?.bandLabelAt);
      composer.render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // picking: a click is a pointer that barely moved
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    const cv = renderer.domElement;
    const pick = (e) => {
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(hits, false)[0];
      // ignore wallets on the far side of the globe
      if (!hit || hit.object.position.clone().normalize().dot(camera.position.clone().normalize()) < 0.1) return null;
      return hit.object.userData.nodeId;
    };
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; };
    const onUp = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const id = pick(e);
        if (id) selectRef.current?.(id === sceneRef.current?.selectedId ? null : id);
      }
      down = null;
    };
    const onMove = (e) => {
      const id = pick(e);
      cv.style.cursor = id ? "pointer" : "grab";
      const r = el.getBoundingClientRect();
      setHover((h) => (id ? { id, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width } : h ? null : h));
    };
    const onLeave = () => setHover(null);
    cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerleave", onLeave);

    sceneRef.current = { camera, controls, wallets, band, bandEdges, bandEdgeMat, anchor, ping, selectedId: null, bandLabelAt: null };

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerleave", onLeave);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose()); });
      composer.dispose?.(); renderer.dispose(); cv.remove();
      sceneRef.current = null;
    };
  }, [plotted, byCountry, rm]);

  // --- camera moves: one tween drives direction + distance together ----------------------
  const anim = useRef(null);
  const flyTo = (dir, dist) => {
    const s = sceneRef.current; if (!s) return;
    anim.current?.stop();
    const fromDir = s.camera.position.clone().normalize(), fromDist = s.camera.position.length();
    const q = new THREE.Quaternion().setFromUnitVectors(fromDir, dir.clone().normalize());
    const q0 = new THREE.Quaternion();
    anim.current = animate(0, 1, {
      duration: rm ? 0 : 0.9, ease: [0.2, 0, 0, 1],
      onUpdate: (u) => {
        const d = fromDir.clone().applyQuaternion(q0.clone().slerp(q, u));
        s.camera.position.copy(d.multiplyScalar(fromDist + (dist - fromDist) * u));
      },
    });
  };
  useEffect(() => () => anim.current?.stop(), []);

  // --- selection: highlight, band, ping, and frame both ends ---------------------------
  useEffect(() => {
    const s = sceneRef.current; if (!s) return;
    s.selectedId = selectedId ?? null;
    for (const [id, w] of s.wallets) {
      const on = id === selectedId, dim = selectedId && !on;
      // three.js materials are imperative scene objects, not React state
      // eslint-disable-next-line react-hooks/immutability
      w.spikeMat.opacity = dim ? 0.2 : 0.85;
      w.headMat.opacity = dim ? 0.25 : 1;
      w.head.scale.setScalar(on ? 0.09 : 0.05);
      w.headMat.color.set(on ? 0xffffff : ION);
      if (w.arc) { w.arc.lineMat.opacity = on ? 1 : dim ? 0.06 : 0.45; w.arc.pulseMat.opacity = dim ? 0.1 : 1; }
    }
    const w = selectedId ? s.wallets.get(selectedId) : null;
    const b = w?.p.band;
    s.band.visible = s.bandEdges.visible = s.anchor.visible = !!b;
    s.ping.visible = !!w;
    s.bandLabelAt = null;
    s.bandEdges.children.forEach((c) => c.geometry.dispose());
    s.bandEdges.clear();
    if (b) {
      // the shaded object is the timezone band itself — the longitudes sharing that offset
      const [lon0, lon1] = bandLonRange(b.offset);
      s.band.geometry.dispose();
      s.band.geometry = new THREE.SphereGeometry(R * 1.004, 24, 48, (lon0 + 180) * DEG, (lon1 - lon0) * DEG);
      for (const lon of [lon0, lon1]) {
        s.bandEdges.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 61 }, (_, i) => toVec(-90 + i * 3, lon, R * 1.005))), s.bandEdgeMat));
      }
      const a = toVec(b.lat, b.lon, R * 1.003);
      s.anchor.position.copy(a); s.anchor.lookAt(a.clone().multiplyScalar(2));
      s.bandLabelAt = toVec(Math.min(70, b.lat + 22), b.offset * 15, R * 1.02);
    }
    if (w) {
      s.ping.position.copy(toVec(w.p.lat, w.p.lon, R * 1.003)); s.ping.lookAt(s.ping.position.clone().multiplyScalar(2));
      s.controls.autoRotate = false;
      const end = b ? toVec(b.lat, b.lon) : w.base;
      flyTo(w.base.clone().add(end), Math.max(DIST_MIN + 0.5, Math.min(DIST_HOME, 2.4 + w.base.angleTo(end) * 1.1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, plotted]);

  const reset = () => {
    onSelect?.(null);
    const s = sceneRef.current; if (!s) return;
    flyTo(s.camera.position, DIST_HOME);
    if (!rm) setTimeout(() => { if (sceneRef.current) sceneRef.current.controls.autoRotate = true; }, 1000);
  };
  const zoomBy = (f) => {
    const s = sceneRef.current; if (!s) return;
    flyTo(s.camera.position, Math.max(DIST_MIN, Math.min(DIST_MAX, s.camera.position.length() / f)));
  };

  const hovered = hover && plotted.find((p) => p.nodeId === hover.id);
  const band = selected?.band ?? null;

  return (
    <div ref={wrapRef} className="viewport" style={{ height: 540 }} onDoubleClick={reset}
      role="img" aria-label={`Globe of ${plotted.length} flagged wallets by claimed country`}>
      <div className="hudc" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="readout" aria-hidden="true">
        <div><span className="rec" />Claimed vs. active</div>
        <div>Wallets <b>{plotted.length}</b> · countries <b>{byCountry.length}</b></div>
        {selected && <div>Target <b>{selected.claimedCountry}</b>{band ? <> → <b style={{ color: "var(--ember)" }}>{band.name}</b></> : null}</div>}
      </div>

      {byCountry.map((c) => (
        <span key={c.code} className="glabel" style={{ opacity: 0 }}
          data-dim={selected && selected.claimedCountry !== c.code ? "1" : "0"}
          ref={(n) => { if (n) labelRefs.current.set(c.code, n); else labelRefs.current.delete(c.code); }}>
          {c.code}<em>×{c.n}</em>
        </span>
      ))}
      <span className="glabel band" style={{ opacity: 0 }} data-dim="0"
        ref={(n) => { if (n) labelRefs.current.set("__band", n); else labelRefs.current.delete("__band"); }}>
        {band ? `UTC${band.offset >= 0 ? "+" : ""}${band.offset} · ${band.name}` : ""}
      </span>

      {hovered && (
        <div className="gtip" style={{ left: Math.max(8, Math.min(hover.x + 14, hover.w - 330)), top: hover.y + 14 }}>
          <b>{hovered.nodeId}</b>
          claims {hovered.claimedCountry} ({hovered.countryName})
          {hovered.reason && <div style={{ marginTop: 4 }}>{hovered.reason}</div>}
        </div>
      )}

      <div className="ctrls">
        <button className="btn sm" onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button className="btn sm" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button className="btn sm" onClick={reset}>Reset</button>
      </div>
      <div className="legend">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ion)", boxShadow: "0 0 8px var(--ion)" }} />Claimed country</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i style={{ width: 22, height: 2, borderRadius: 2, background: "linear-gradient(90deg, var(--ion), var(--ember))" }} />Arc to where activity fits</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i style={{ width: 12, height: 10, borderRadius: 2, background: "var(--ember-tint)", boxShadow: "0 0 0 1px var(--ember) inset" }} />Timezone band (selected)</span>
        <span className="hint">Drag to spin · scroll to zoom · click a wallet · double-click to reset</span>
      </div>
    </div>
  );
}
