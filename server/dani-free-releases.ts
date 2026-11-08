// Fixed release assets verified against GitHub digests; no mutable download URL.
import type { StandaloneRelease } from "./contracts.ts";
export const DANI_FREE_KILO: StandaloneRelease = {
  "name": "Dani Free",
  "engine": "dani-free-kilo",
  "version": "1.0.25",
  "hosts": [
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com"
  ],
  "runEnv": {
    "DANI_FREE_PROBE_ON_REFRESH": "0",
    "DANI_FREE_ENGINE_AUTOUPDATE": "0",
    "DANI_FREE_DISABLE_OPENCODE": "1"
  },
  "assets": {
    "linux-x64": {
      "url": "https://github.com/Kilo-Org/kilo/releases/download/v1.0.25/kilo-linux-x64-baseline.tar.gz",
      "sha256": "eded0f3c012d48e978ce90c06c1456b28107babd1d0da7df9713922186e2ce93",
      "executableSha256": "127a5d551700a9acd67f7b98649f2561dc87be9f24037f443d087595b31bc9f3",
      "archive": "tar.gz",
      "executable": "kilo",
      "approxBytes": 53829095
    },
    "win32-x64": {
      "url": "https://github.com/Kilo-Org/kilo/releases/download/v1.0.25/kilo-windows-x64-baseline.zip",
      "sha256": "861287b720619bb77cd61f1e00380271d99c8c7bd74c9d1c0f7a73181aa710dd",
      "executableSha256": "e2a62d0b0b8b907e230d6ff6e12e0550f482c340e37321eb16c164a21071f246",
      "archive": "zip",
      "executable": "kilo.exe",
      "approxBytes": 54942149
    },
    "darwin-arm64": {
      "url": "https://github.com/Kilo-Org/kilo/releases/download/v1.0.25/kilo-darwin-arm64.zip",
      "sha256": "80e2111ba9aa4ec159a45ff8aa038d7628477bcb6a16112e508ee5929eaebec0",
      "executableSha256": "606ab11cd233fb9c6ff7aa3549e3345e287db096a4d3146dec7d5b172e20d7ed",
      "approxBytes": 36541566,
      "archive": "zip",
      "executable": "kilo"
    },
    "darwin-x64": {
      "url": "https://github.com/Kilo-Org/kilo/releases/download/v1.0.25/kilo-darwin-x64-baseline.zip",
      "sha256": "dad59e896d9ae6c91bdc55fca2aa32df2a79ea8b8623a3e6bd2e626e20ec76fe",
      "executableSha256": "95c954866b4464f1e4d7e433b6ddfe841d07992ec9c471346154034b5d014006",
      "approxBytes": 38480801,
      "archive": "zip",
      "executable": "kilo"
    }
  }
};
export const DANI_FREE_PROXY: StandaloneRelease = {
  "name": "Dani Free",
  "engine": "dani-free-proxy",
  "version": "0.1.1-dani-dex.1",
  "hosts": [
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com"
  ],
  "runEnv": {
    "DANI_FREE_PROBE_ON_REFRESH": "0",
    "DANI_FREE_ENGINE_AUTOUPDATE": "0",
    "DANI_FREE_DISABLE_OPENCODE": "1"
  },
  "assets": {
    "linux-x64": {
      "url": "https://github.com/somdipto/Dani-Free-proxy/releases/download/v0.1.1-dani-dex.1/dani-free-linux-x64",
      "sha256": "a82f98348c4c38b98b9b13b104545d882b3dd489e2026218e9bf562730ee2239",
      "executableSha256": "a82f98348c4c38b98b9b13b104545d882b3dd489e2026218e9bf562730ee2239",
      "archive": "raw",
      "executable": "dani-free",
      "approxBytes": 81417696
    },
    "win32-x64": {
      "url": "https://github.com/somdipto/Dani-Free-proxy/releases/download/v0.1.1-dani-dex.1/dani-free-windows-x64.exe",
      "sha256": "ab37b6ecea1e418f5c8784afe6492ce9e588f3188d72cc64d055929638704856",
      "executableSha256": "ab37b6ecea1e418f5c8784afe6492ce9e588f3188d72cc64d055929638704856",
      "archive": "raw",
      "executable": "dani-free.exe",
      "approxBytes": 86192128
    },
    "darwin-arm64": {
      "url": "https://github.com/somdipto/Dani-Free-proxy/releases/download/v0.1.1-dani-dex.1/dani-free-darwin-arm64",
      "sha256": "12347b8acc2b690e67541641fee1ee7d1ec91d702e34f5da64cbc2f922adcd9f",
      "executableSha256": "12347b8acc2b690e67541641fee1ee7d1ec91d702e34f5da64cbc2f922adcd9f",
      "approxBytes": 62326002,
      "archive": "raw",
      "executable": "dani-free"
    },
    "darwin-x64": {
      "url": "https://github.com/somdipto/Dani-Free-proxy/releases/download/v0.1.1-dani-dex.1/dani-free-darwin-x64",
      "sha256": "d12ea4d5d0f66ec716fc51d6989398796411b97868fe17a235811a5cc0e0bbd6",
      "executableSha256": "d12ea4d5d0f66ec716fc51d6989398796411b97868fe17a235811a5cc0e0bbd6",
      "approxBytes": 69431568,
      "archive": "raw",
      "executable": "dani-free"
    }
  },
  "startupProbe": {
    "args": [
      "--help"
    ],
    "includes": "Usage: dani-free"
  }
};
