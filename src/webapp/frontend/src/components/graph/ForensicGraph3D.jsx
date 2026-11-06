import { useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { clusterColor } from "../../lib/clusterColors";
import { CHART_COLORS as C } from "../../lib/chartColors";

// Pure black on purpose: once the bloom composer is active the clear colour gets sRGB-encoded a
// second time, which lifts any tinted near-black (#02040a came out as #162238). Black survives it.
const BG = "#000000";
const CONTEXT = "#3a4a68";
const LINK = "rgba(88,225,255,0.5)";

let glowTexture = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(0.25, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

const radiusOf = (n) => (n.is_context ? 3.2 : 5.5 + (n.risk_score ?? 0) * 11);

/** One node: a bright core, an additive halo, and — for geo-temporal mismatches — two crimson gyro rings. */
function buildNode(n, rings) {
  const color = n.is_context ? CONTEXT : clusterColor(n.cluster_id);
  const r = radiusOf(n);
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: n.is_context ? 0.7 : 1 }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: n.is_context ? 0.12 : 0.5,
  }));
  halo.scale.setScalar(r * 6);
  group.add(core, halo);
  if (n.geo_temporal_flag) {
    // crimson rings = the same geo-temporal signal used everywhere else in the app
    const mat = new THREE.MeshBasicMaterial({ color: C.DOWN, transparent: true, opacity: 0.95 });
    const a = new THREE.Mesh(new THREE.TorusGeometry(r * 1.9, r * 0.09, 8, 48), mat);
    const b = new THREE.Mesh(new THREE.TorusGeometry(r * 2.3, r * 0.05, 8, 48), mat);
    a.rotation.x = Math.PI / 2; b.rotation.y = Math.PI / 3;
    group.add(a, b); rings.push(a, b);
  }
  n.__mats = { core: core.material, halo: halo.material, base: { core: core.material.opacity, halo: halo.material.opacity } };
  return group;
}

/** Targeting reticle that sits on the focused node and always faces the camera. */
function buildReticle() {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: C.VIOLET, transparent: true, opacity: 0.9 });
  const circle = new THREE.BufferGeometry().setFromPoints(new THREE.Path().absarc(0, 0, 1, 0, Math.PI * 2).getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0)));
  g.add(new THREE.Line(circle, mat));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const tick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0), new THREE.Vector3(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 0)]);
    g.add(new THREE.Line(tick, mat));
  }
  g.visible = false;
  return g;
}

/**
 * 3D force-directed forensic graph, rendered as a bloom-lit starfield.
 *
 * Encoding (all data-driven, unchanged):
 *   colour     cluster_id (spectral ramp); context nodes stay a dim slate
 *   size       risk_score
 *   rings      geo-temporal mismatch -> crimson gyro rings around the node
 * Flow: particles run along every edge; hovering a node lights its edges in ember and
 * dims everything it is not connected to. Click a node -> onSelectNode(id).
 * focusNodeId flies the camera there and pins a reticle on it. The camera drifts in a slow
 * orbit until the user takes the controls. Reduced motion: no drift, no fly, short settle.
 */
export default function ForensicGraph3D({ data, focusNodeId, onSelectNode, height = "62vh" }) {
  const elRef = useRef(null);
  const graphRef = useRef(null);
  const selectRef = useRef(onSelectNode);
  const focusRef = useRef(focusNodeId);
  useEffect(() => { selectRef.current = onSelectNode; }, [onSelectNode]);
  useEffect(() => { focusRef.current = focusNodeId; }, [focusNodeId]);

  const rm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const ids = new Set(data.nodes.map((n) => n.id));
    return {
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to })),
    };
  }, [data]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || graphData.nodes.length === 0) return;

    const rings = [];
    const hl = { node: null, links: new Set(), nodes: new Set() };
    const isHot = (l) => hl.links.has(l);

    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .backgroundColor(BG)
      .showNavInfo(false)
      .nodeId("id")
      .nodeThreeObject((n) => buildNode(n, rings))
      .nodeLabel((n) => {
        const risk = typeof n.risk_score === "number" ? n.risk_score.toFixed(4) : "not scored (context)";
        return `<div style="font:12px 'Geist Variable',system-ui,sans-serif;color:#9aa8c2;background:rgba(6,10,19,.94);border-radius:10px;box-shadow:0 0 0 1px rgba(126,170,255,.22),0 20px 40px -10px rgba(0,0,0,.8);padding:10px 12px;max-width:320px;white-space:normal">
          <div style="font-family:'Geist Mono Variable',monospace;color:#e4ecf8;margin-bottom:4px;word-break:break-all">${n.id}</div>
          <div>Risk <b style="color:#e4ecf8">${risk}</b>${n.cluster_id != null ? ` · cluster <b style="color:${clusterColor(n.cluster_id)}">${n.cluster_id}</b>` : ""}</div>
          ${n.intent_label ? `<div>${n.intent_label}</div>` : ""}
          ${n.geo_temporal_flag ? `<div style="color:${C.DOWN}">Geo-temporal mismatch</div>` : ""}
        </div>`;
      })
      .linkColor((l) => (isHot(l) ? C.EMBER : LINK))
      .linkWidth((l) => (isHot(l) ? 2.2 : 0.9))
      .linkOpacity(0.55)
      .linkDirectionalParticles((l) => (isHot(l) ? 4 : 1))
      .linkDirectionalParticleWidth((l) => (isHot(l) ? 3.4 : 2))
      .linkDirectionalParticleSpeed(rm ? 0 : 0.005)
      .linkDirectionalParticleColor((l) => (isHot(l) ? C.EMBER : "#9aefff"))
      .onNodeClick((n) => selectRef.current?.(String(n.id)))
      .onNodeHover((n) => {
        el.style.cursor = n ? "pointer" : null;
        if (hl.node === n) return;
        hl.node = n; hl.links.clear(); hl.nodes.clear();
        if (n) {
          hl.nodes.add(n);
          for (const l of g.graphData().links) if (l.source === n || l.target === n) { hl.links.add(l); hl.nodes.add(l.source); hl.nodes.add(l.target); }
        }
        for (const x of g.graphData().nodes) {
          const m = x.__mats; if (!m) continue;
          const dim = n && !hl.nodes.has(x);
          m.core.opacity = dim ? 0.18 : m.base.core;
          m.halo.opacity = dim ? 0.04 : m.base.halo;
        }
        // re-set accessors so the renderer re-reads them
        g.linkColor(g.linkColor()).linkWidth(g.linkWidth())
          .linkDirectionalParticles(g.linkDirectionalParticles()).linkDirectionalParticleWidth(g.linkDirectionalParticleWidth())
          .linkDirectionalParticleColor(g.linkDirectionalParticleColor());
      })
      .cooldownTicks(rm ? 40 : 160)
      .d3VelocityDecay(0.3)
      .graphData(graphData);

    g.d3Force("charge").strength(-120);
    g.d3Force("link").distance(34);

    const scene = g.scene();
    // faint, distant starfield — kept far dimmer and smaller than any node so it never reads as data
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2200 + Math.random() * 1400);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x4a5a7c, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.45 }));
    const reticle = buildReticle();
    scene.add(stars, reticle);

    // tight radius + high threshold: only node cores bloom. A wide, low-threshold bloom smears
    // the 290 additive halos into a uniform fog over the whole canvas.
    const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.95, 0.22, 0.55);
    g.postProcessingComposer().addPass(bloom);

    // idle orbit; the user taking the controls stops it, and it resumes after a pause
    const controls = g.controls();
    let resume = 0;
    if (controls && !rm) {
      controls.autoRotate = true; controls.autoRotateSpeed = 0.55; controls.enableDamping = true;
      controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resume); });
      controls.addEventListener("end", () => { clearTimeout(resume); resume = setTimeout(() => { controls.autoRotate = true; }, 6000); });
    }
    let fitted = false;
    // frame the scored entities, not the far-flung context nodes around them
    g.onEngineStop(() => { if (!fitted && !focusRef.current) g.zoomToFit(rm ? 0 : 900, 20, (n) => !n.is_context); fitted = true; });

    let raf = 0;
    const byId = new Map(g.graphData().nodes.map((n) => [n.id, n]));
    const loop = (t) => {
      for (let i = 0; i < rings.length; i++) { rings[i].rotation.z = t * 0.0012 * (i % 2 ? -1 : 1); }
      const f = focusRef.current && byId.get(focusRef.current);
      reticle.visible = !!(f && f.x !== undefined);
      if (reticle.visible) {
        reticle.position.set(f.x, f.y, f.z);
        reticle.quaternion.copy(g.camera().quaternion);
        reticle.scale.setScalar(radiusOf(f) * (2.6 + (rm ? 0 : Math.sin(t * 0.004) * 0.25)));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); g.width(r.width); g.height(r.height); bloom.setSize(r.width, r.height); });
    ro.observe(el);
    graphRef.current = g;

    return () => {
      cancelAnimationFrame(raf); clearTimeout(resume); ro.disconnect();
      g.pauseAnimation(); g._destructor?.(); graphRef.current = null;
    };
  }, [graphData, rm]);

  // Camera fly-to on focus — after the engine has had time to place nodes.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !focusNodeId) return;
    const t = setTimeout(() => {
      const node = g.graphData().nodes.find((n) => n.id === focusNodeId);
      if (!node || node.x === undefined) return;
      const dist = 110;
      const ratio = 1 + dist / Math.hypot(node.x, node.y, node.z);
      g.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, rm ? 0 : 900);
    }, 600);
    return () => clearTimeout(t);
  }, [focusNodeId, graphData, rm]);

  return <div ref={elRef} style={{ width: "100%", height, background: BG }} />;
}
