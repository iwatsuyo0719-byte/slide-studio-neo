import type { NextConfig } from "next";
const config: NextConfig = {
    serverExternalPackages: [],
    experimental: { cpus: 2 },
    poweredByHeader: false,
    // 依頼フォルダ（workspace/）とログは画面のコードではないので監視しない。監視が state.json を掴むと、Windowsで保存の置き換えが拒否される
    webpack: (webpackConfig, { dev }) => {
        if (dev)
            webpackConfig.watchOptions = { ...webpackConfig.watchOptions, ignored: ['**/node_modules/**', '**/.git/**', '**/workspace/**', '**/work/**'] };
        return webpackConfig;
    },
};
export default config;
