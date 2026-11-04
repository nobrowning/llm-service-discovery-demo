import { defaultServicesForNode } from '../mock-api/index.mjs';

export function validateScene(scene) {
  if (scene !== undefined && !['company', 'home'].includes(scene)) throw new Error('Scene must be company or home. Omit --scene to keep the standard Demo.');
  return scene;
}

/** Presentation and initial availability only; no endpoint, model ID or auth changes. */
export function servicesForScene(node, scene) {
  validateScene(scene);
  const services = defaultServicesForNode(node);
  if (scene === undefined) return services;
  const homeModel = defaultServicesForNode('C')[0];
  return services.map(service => {
    const homeText = scene === 'home' && service.id === 'a-text';
    const display_name = homeText ? `家庭·${homeModel.display_name}` : `公司·${service.display_name}`;
    const enabled = scene === 'company' || homeText;
    return { ...service, display_name, label: display_name.replaceAll('.', '-'),
      deployment: structuredClone(homeText ? homeModel.deployment : service.deployment), enabled, ready: enabled };
  });
}
