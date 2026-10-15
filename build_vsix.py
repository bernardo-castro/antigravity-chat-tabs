import json
import os
import shutil
import subprocess
import zipfile

EXT_DIR = os.path.dirname(os.path.abspath(__file__))
VSIX_PATH = os.path.join(EXT_DIR, "antigravity-chat-tabs-1.0.0.vsix")
OLD_IDE_EXT_DIR = os.path.expanduser(
    r"~\.antigravity-ide\extensions\jcastro.antigravity-chat-tabs-1.0.0"
)
TARGET_IDE_EXT_DIR = os.path.expanduser(
    r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.0.0"
)

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="antigravity-chat-tabs" Version="1.0.0" Publisher="BernardoCastroDev" />
    <DisplayName>Antigravity Chat Tabs</DisplayName>
    <Description xml:space="preserve">Adds a horizontal multi-session tab bar (Kiro style) to the Antigravity IDE Agent side panel, with per-workspace persistence and automatic re-application after IDE updates.</Description>
    <Tags>antigravity,chat,tabs,agent,sessions</Tags>
    <Categories>Other,Appearance</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
"""

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>
"""


def main() -> None:
    res = subprocess.run(
        ["node", "--check", os.path.join(EXT_DIR, "extension.js")],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(res.stderr)
    print("[OK] extension.js passed node --check")

    pkg_path = os.path.join(EXT_DIR, "package.json")
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)
    if "icon" in pkg and not os.path.exists(os.path.join(EXT_DIR, pkg["icon"])):
        pkg.pop("icon", None)
        with open(pkg_path, "w", encoding="utf-8") as f:
            json.dump(pkg, f, indent=2)

    with zipfile.ZipFile(VSIX_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES.strip())
        zf.writestr("extension.vsixmanifest", MANIFEST.strip())
        for fname in ["package.json", "extension.js", "README.md", "LICENSE"]:
            zf.write(os.path.join(EXT_DIR, fname), f"extension/{fname}")

    print(f"[OK] Built VSIX: {VSIX_PATH} ({os.path.getsize(VSIX_PATH)} bytes)")

    if os.path.exists(OLD_IDE_EXT_DIR):
        shutil.rmtree(OLD_IDE_EXT_DIR, ignore_errors=True)
        print(f"[OK] Removed old extension dir: {OLD_IDE_EXT_DIR}")

    os.makedirs(TARGET_IDE_EXT_DIR, exist_ok=True)
    for fname in ["package.json", "extension.js", "README.md", "LICENSE"]:
        shutil.copy2(os.path.join(EXT_DIR, fname), os.path.join(TARGET_IDE_EXT_DIR, fname))
    print(f"[OK] Installed extension into: {TARGET_IDE_EXT_DIR}")


if __name__ == "__main__":
    main()
