// Every integration the app knows about. Add a plugin file here to make it appear on the Plugins page.
import facebook from './facebook.js';
import linkedin from './linkedin.js';

export const plugins = [facebook, linkedin];
export const pluginById = (id) => plugins.find((p) => p.id === id);
