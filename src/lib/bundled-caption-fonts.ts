// Exact Google Fonts sources, shared by the editor, release inventory and packaging.
const upstreamCommit = "c30b221beb0c1da59d563feb91ec8656a1fa972a";
const sources = [
  {
    id: "dohyeon",
    family: "Do Hyeon",
    file: "DoHyeon-Regular.ttf",
    weight: 400,
    version: "Version 1.001",
    fontSize: 879764,
    fontSha256: "35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653",
    licenseSize: 4347,
    licenseSha256: "de5ff32211a4340b01477af39ee339d639438955e409f79b666d4b9207f3c92c"
  },
  {
    id: "jua",
    family: "Jua",
    file: "Jua-Regular.ttf",
    weight: 400,
    version: "Version 1.001",
    fontSize: 2119352,
    fontSha256: "769677aef240bfc3b9965f2b50748075bff885e6c6992fc591a3fb268279f898",
    licenseSize: 4342,
    licenseSha256: "44a7c6e4c5572392ae122d3b1d8c6ba6fd640a7797e675384585d947f2773e3c"
  },
  {
    id: "nanummyeongjo",
    family: "Nanum Myeongjo",
    file: "NanumMyeongjo-ExtraBold.ttf",
    weight: 800,
    version: "Version 2.032;PS 1;hotconv 1.0.56;makeotf.lib2.0.21325",
    fontSize: 3180888,
    fontSha256: "60c0077fce069ba90ae97c0a3679f6eb3712e0ca637bdd0c15b72d335ec46db7",
    licenseSize: 4497,
    licenseSha256: "8eb1c1019fe7fe6d0b6e7d7bbbba1d9cbdd969d8c5f26455708f6cfb8a77284c"
  },
  {
    id: "blackhansans",
    family: "Black Han Sans",
    file: "BlackHanSans-Regular.ttf",
    weight: 400,
    version: "Version 1.001",
    fontSize: 998424,
    fontSha256: "31960809284026681774a8e52dc19ebcad26cf69b0ad9d560f288296fbb52739",
    licenseSize: 4399,
    licenseSha256: "c324192c8b3a988bae45a9a7e4ac1258b684739003bda114e0523423440457c9"
  },
  {
    id: "gaegu",
    family: "Gaegu",
    file: "Gaegu-Bold.ttf",
    weight: 700,
    version: "Version 1.00",
    fontSize: 2962664,
    fontSha256: "cc38a4af9506a45254d1ce07c589ec473d9e5f0be319e5a77b17c214903f8c1c",
    licenseSize: 4344,
    licenseSha256: "53a9ce47085d9fef613c7ecb3730dc80d25962510bbea231b89564f58240f251"
  },
  {
    id: "gugi",
    family: "Gugi",
    file: "Gugi-Regular.ttf",
    weight: 400,
    version: "Version 3.00",
    fontSize: 990856,
    fontSha256: "c0b1f979979cfc309fb2438fa9464f96173353e0c4842cc7a5919658184ed9d3",
    licenseSize: 4374,
    licenseSha256: "391ac3126dacc95b92a8f3408467879edb3245344bc411530a30d5aada52df92"
  },
  {
    id: "eastseadokdo",
    family: "East Sea Dokdo",
    file: "EastSeaDokdo-Regular.ttf",
    weight: 400,
    version: "Version 1.00",
    fontSize: 3178684,
    fontSha256: "8cebb39d375134fdbcedef9bf4ec4f6c3f02c39ed0aacd6e83f7a0f435e593b2",
    licenseSize: 4354,
    licenseSha256: "39de3de5f1873f89bca4af37823ab22e28e88d0d8f7fe2f07e82e9e6e9bf7b70"
  }
] as const;

export const ADDITIONAL_CAPTION_FONTS = Object.freeze(sources.map((font) => ({
  ...font,
  upstreamCommit,
  upstreamUrl: `https://github.com/google/fonts/tree/${upstreamCommit}/ofl/${font.id}`,
  sourceFontPath: `vendor/${font.id}/${font.file}`,
  sourceLicensePath: `vendor/${font.id}/OFL.txt`,
  webFontPath: `editor/fonts/${font.file}`,
  webLicensePath: `licenses/${font.id.toUpperCase()}-OFL-1.1.txt`
})));
