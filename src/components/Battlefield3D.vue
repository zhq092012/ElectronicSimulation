<template>
  <div ref="container" class="battlefield-3d-canvas"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';

const props = defineProps<{
  nodes: any[];
  links: any[];
}>();

const emit = defineEmits<{
  (e: 'select-node', id: string, type: 'ASSET' | 'WEAPON'): void;
}>();

const container = ref<HTMLDivElement | null>(null);
let Graph: any = null;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!container.value) return;

  Graph = (ForceGraph3D as any)()(container.value)
    .graphData({ 
      nodes: JSON.parse(JSON.stringify(props.nodes)), 
      links: JSON.parse(JSON.stringify(props.links)) 
    })
    .backgroundColor('rgba(8, 12, 22, 0.0)')
    .showNavInfo(false)
    .nodeLabel(() => '') // We use SpriteText instead of native tooltip for always-on labels
    .linkColor((link: any) => {
      if (link.link_status === 'TRANSMITTING') return 'rgba(0, 102, 255, 0.6)';
      if (link.link_status === 'JAMMED') return 'rgba(234, 179, 8, 0.6)';
      if (link.link_status === 'DESTROYED') return 'rgba(0, 0, 0, 0)';
      if (link.link_status === 'ENGAGEMENT') return 'rgba(255, 42, 95, 0.85)';
      return 'rgba(107, 114, 128, 0.25)';
    })
    .linkWidth((link: any) => {
      if (link.link_status === 'TRANSMITTING') return 2.0;
      if (link.link_status === 'JAMMED') return 1.5;
      if (link.link_status === 'ENGAGEMENT') return 2.5;
      return 0.5;
    })
    .linkMaterial((link: any) => {
      if (link.link_status === 'JAMMED') {
        return new THREE.LineDashedMaterial({
          color: 0xeab308,
          dashSize: 5,
          gapSize: 3,
          transparent: true,
          opacity: 0.8
        });
      } else if (link.link_status === 'DESTROYED') {
        return new THREE.LineBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0
        });
      } else if (link.link_status === 'ENGAGEMENT') {
        return new THREE.LineBasicMaterial({
          color: 0xff2a5f,
          transparent: true,
          opacity: 0.9
        });
      }
      return false; // Use default material
    })
    .linkDirectionalParticles((link: any) => {
      if (link.link_status === 'TRANSMITTING') return 3;
      if (link.link_status === 'JAMMED') return 1;
      if (link.link_status === 'ENGAGEMENT') return 4;
      return 0;
    })
    .linkDirectionalParticleColor((link: any) => {
      if (link.link_status === 'TRANSMITTING') return '#00e1ff';
      if (link.link_status === 'JAMMED') return '#eab308';
      if (link.link_status === 'ENGAGEMENT') return '#ff2a5f';
      return '#4b5563';
    })
    .linkDirectionalParticleWidth(2.5)
    .linkDirectionalParticleSpeed((link: any) => {
      if (link.link_status === 'JAMMED') return 0.003;
      if (link.link_status === 'ENGAGEMENT') return 0.016;
      return 0.012;
    })
    .onNodeClick((node: any) => {
      const type = node.id.startsWith('weapon-') ? 'WEAPON' : 'ASSET';
      emit('select-node', node.id, type);
    });

  // Force Directed Layout & Bounding Box
  Graph.onEngineTick(() => {
    if (!Graph) return;
    const data = Graph.graphData();
    if (!data || !data.nodes) return;
    data.nodes.forEach((node: any) => {
      if (node.fz !== undefined && node.fz !== null) {
        node.z = node.fz;
      }
      if (node.fx !== undefined && node.fx !== null) {
        node.x = node.fx;
      }
      if (node.fy !== undefined && node.fy !== null) {
        node.y = node.fy;
      }
    });
  });

  const scene = Graph.scene();

  const gridConfigs = [
    { z: 150, color: '#00e1ff', opacity: 0.15 },  // 太空网格 (Space)
    { z: 0, color: '#10b981', opacity: 0.15 },    // 空域网格 (Air)
    { z: -150, color: '#3b82f6', opacity: 0.18 }  // 地面网格 (Ground)
  ];

  gridConfigs.forEach(config => {
    const grid = new THREE.GridHelper(500, 30, config.color, config.color);
    grid.position.z = config.z;
    grid.rotation.x = Math.PI / 2;

    const mat = grid.material as any;
    mat.transparent = true;
    mat.opacity = config.opacity;
    mat.depthWrite = false;

    scene.add(grid);
  });

  // Custom 3D Objects with Labels
  Graph.nodeThreeObject((node: any) => {
    const isDestroyed = node.anti_jam_level === 0 && node.base_priority === 0;
    
    let color = node.side === 'RED' ? '#ff2a5f' : '#00e1ff';
    if (isDestroyed) {
      color = '#374151'; // Destroyed goes dark
    }

    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      emissive: isDestroyed ? 0xff0000 : 0x000000,
      emissiveIntensity: isDestroyed ? 0.6 : 0
    });

    const group = new THREE.Group();
    let mesh;

    if (node.asset_class === 'SATELLITE') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), material);
      const wingMat = new THREE.MeshLambertMaterial({ color: isDestroyed ? '#1f2937' : '#2d3748', transparent: true, opacity: 0.65 });
      const leftWing = new THREE.Mesh(new THREE.BoxGeometry(18, 3, 0.5), wingMat);
      body.add(leftWing);
      mesh = body;
    } else if (node.asset_class === 'DRONE') {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 4), material);
      mesh.rotation.x = Math.PI / 2;
    } else if (node.asset_class === 'STATION') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 8, 8), material);
      mesh.rotation.x = Math.PI / 2;
    } else if (node.asset_class === 'COMMAND_CENTER') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), material);
    } else if (node.id.startsWith('weapon-')) {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(6, 14, 4), material);
      mesh.rotation.x = -Math.PI / 2;
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), material);
    }

    group.add(mesh);

    // SpriteText Label
    const usageStr = node.usage_type === 'MILITARY' ? '(军用)' : node.usage_type === 'CIVIL_COMMERCIAL' ? '(民用)' : '';
    const classStr = node.asset_class ? `[${node.asset_class}]` : '';
    const nameStr = node.name || node.id;
    
    const label = new SpriteText(`${nameStr}\n${classStr} ${usageStr}`);
    label.color = node.side === 'RED' ? '#ff87a3' : '#a5f3fc';
    label.textHeight = 3.5;
    label.position.set(0, -12, 0); // Display below the mesh
    group.add(label);

    return group;
  });

  // Fixed 45-degree isometric initial camera with Z-up logic
  const camera = Graph.camera();
  const controls = Graph.controls();
  
  if (camera && controls) {
    // Set Z as the logical vertical up axis
    camera.up.set(0, 0, 1);
    
    // Position camera to look at the center from an angle
    Graph.cameraPosition({ x: 0, y: -450, z: 250 }, { x: 0, y: 0, z: 0 }, 1000);
    
    // Enable free rotation and panning
    controls.enablePan = true;
    controls.update();
  }

  // ResizeObserver to automatically fit the container size
  resizeObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      const { width, height } = entry.contentRect;
      if (Graph) {
        Graph.width(width);
        Graph.height(height);
      }
    }
  });
  resizeObserver.observe(container.value);
});

// Watch for data changes
watch(() => [props.nodes, props.links], ([newNodes, newLinks]) => {
  if (Graph) {
    const clonedNodes = JSON.parse(JSON.stringify(newNodes));
    const clonedLinks = JSON.parse(JSON.stringify(newLinks));
    Graph.graphData({ nodes: clonedNodes, links: clonedLinks });
  }
}, { deep: true });

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (Graph && container.value) {
    container.value.innerHTML = '';
    Graph = null;
  }
});
</script>

<style scoped lang="scss">
.battlefield-3d-canvas {
  outline: none;
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
