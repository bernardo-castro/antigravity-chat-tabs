import json
import os
import shutil
import subprocess
import zipfile

EXT_DIR = os.path.dirname(os.path.abspath(__file__))
VSIX_PATH = os.path.join(EXT_DIR, "antigravity-chat-tabs-1.3.0.vsix")
OLD_IDE_EXT_DIRS = [
    os.path.expanduser(r"~\.antigravity-ide\extensions\jcastro.antigravity-chat-tabs-1.0.0"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.0.0"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.0.1"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.1.0"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.1.1"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.2.0"),
    os.path.expanduser(r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.2.1"),
]
TARGET_IDE_EXT_DIR = os.path.expanduser(
    r"~\.antigravity-ide\extensions\BernardoCastroDev.antigravity-chat-tabs-1.3.0"
)

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="antigravity-chat-tabs" Version="1.3.0" Publisher="BernardoCastroDev" />
    <DisplayName>Antigravity Chat Tabs</DisplayName>
    <Description xml:space="preserve">Adds a horizontal multi-session tab bar (Kiro style) to the Antigravity IDE Agent side panel, with per-workspace persistence and automatic re-application after IDE updates.</Description>
    <Tags>antigravity,chat,tabs,agent,sessions</Tags>
    <Categories>Other,Appearance</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Icon>extension/icon.png</Icon>
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
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
"""

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="png" ContentType="image/png"/>
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

    files = ["package.json", "extension.js", "README.md", "LICENSE", "icon.png"]
    with zipfile.ZipFile(VSIX_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES.strip())
        zf.writestr("extension.vsixmanifest", MANIFEST.strip())
        for fname in files:
            zf.write(os.path.join(EXT_DIR, fname), f"extension/{fname}")

    print(f"[OK] Built VSIX: {VSIX_PATH} ({os.path.getsize(VSIX_PATH)} bytes)")

    for old_dir in OLD_IDE_EXT_DIRS:
        if os.path.exists(old_dir):
            shutil.rmtree(old_dir, ignore_errors=True)
            print(f"[OK] Removed old extension dir: {old_dir}")

    os.makedirs(TARGET_IDE_EXT_DIR, exist_ok=True)
    for fname in files:
        shutil.copy2(os.path.join(EXT_DIR, fname), os.path.join(TARGET_IDE_EXT_DIR, fname))
    print(f"[OK] Installed extension into: {TARGET_IDE_EXT_DIR}")


if __name__ == "__main__":
    main()
