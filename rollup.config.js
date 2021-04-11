import { terser } from 'rollup-plugin-terser';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [
  {
    input: 'src/main.js',
    output: {
      name: 'skeletor',
      sourcemap: true,
      file: 'dist/skeletor.js',
      format: 'umd'
    },
    plugins: [nodeResolve()]
  },
  {
    input: 'src/main.js',
    output: {
      name: 'skeletor',
      sourcemap: true,
      file: 'dist/skeletor.min.js',
      format: 'umd'
    },
    plugins: [nodeResolve(), terser()]
  }
];
