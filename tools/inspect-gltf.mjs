import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh()).map(n => n.getName() + (n.getSkin() ? '*' : ''));
  console.log(f.split('/').pop(), '| meshes:', nodes.join(', '), '| tex:', r.listTextures().map(t => t.getURI() || t.getName()).join(','));
}
