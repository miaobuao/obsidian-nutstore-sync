# 🔄 Obsidian Nutstore

此插件允许您通过 WebDAV 协议将 Obsidian 笔记与坚果云进行双向同步。

## ✨ 主要特性

- **双向同步算法**: 跨设备保持笔记同步
- **单点登录 (SSO)**: 无需手动输入 WebDAV 服务器地址、账号以及密钥，只需授权登录即可。
- **远程文件夹选择工具**： 通过图形界面选择远程文件夹，规避了手动输入可能存在的纰漏
- **智能冲突解决**:
  - 自动合并算法：通过字符级别的比较，自动合并发生了更改的文件，让你可以在多个客户端之间同步
  - 出现无法自动合并的情况时，会对文件内容进行标注，此时需要用户手动解决冲突

## ⚠️ 注意事项

1. 由于此插件尚不稳定，请在使用之前**备份整个 Vault**，以免同步过程中出现文件丢失、损坏、目录结构与预期不一致等问题！
2. ⏳ 首次同步可能需要较长时间 (常见于文件夹比较多的情况)
3. 发生冲突时，我们会尝试解决冲突，这个操作会同时更新本地和远程的文件，当冲突无法解决时，文件中会出现冲突标志，此时需要用户手动解决冲突。

### 如何手动解决冲突

如果你在设置里开启了 `使用Git样式的冲突标记`，遇到冲突时会在文件中插入特殊符号: `<<<<<<<`, `=======`, `>>>>>>>`，这些符号在 Obsidian 中会被意外地识别为 Markdown 语法，因此在 Obsidian 里预览的时候会很不方便，此时可以使用 VSCode 打开该文件：

![VSCode中打开存在Git风格的冲突标记示意图](assets/image.png)

其中，绿色区域就是你本地的内容，蓝色区域是云盘伤的的内容。此时，你需要手动修改这份有冲突的文件，把内容修改成理想的样子。

## 🔍 同步算法

```mermaid
flowchart TD
 subgraph s1["文件夹同步流程"]
        RemoteToLocal["检查远程文件夹"]
        SyncFolders["开始文件夹同步"]
        ValidateType["类型验证<br>确保两端都是文件夹"]
        ErrorFolder["错误:类型冲突<br>一端是文件另一端是文件夹"]
        CheckRemoteFolderChanged["检查远程文件夹<br>是否有变更"]
        CreateLocalDir["创建本地文件夹"]
        CheckRemoteRemovable["检查远程是否可删除<br>1.遍历子文件<br>2.验证修改时间"]
        RemoveRemoteFolder["删除远程文件夹"]
        CreateLocalFolder["创建本地文件夹"]
        LocalToRemote["检查本地文件夹"]
        CheckLocalFolderRecord["检查本地同步记录"]
        CreateRemoteFolder["创建远程文件夹"]
        CheckLocalFolderRemovable["检查本地是否可删除<br>1.遍历子文件<br>2.验证修改时间"]
        RemoveLocalFolder["删除本地文件夹"]
        CreateRemoteDirNew["创建远程文件夹"]
  end
 subgraph s2["文件同步流程"]
        CheckSyncRecord["检查同步记录"]
        SyncFiles["开始文件同步"]
        ExistenceCheck["检查文件存在情况"]
        ChangeCheck["检查变更状态<br>对比修改时间"]
        Conflict["冲突解决<br>使用最新时间戳"]
        Download["下载远程文件"]
        Upload["上传本地文件"]
        RemoteOnlyCheck["远程文件检查"]
        DownloadNew["下载新文件"]
        DeleteRemoteFile["删除远程文件"]
        LocalOnlyCheck["本地文件检查"]
        UploadNew["上传新文件"]
        DeleteLocalFile["删除本地文件"]
        NoRecordCheck["检查文件情况"]
        ResolveConflict["解决冲突<br>使用最新时间戳"]
        PullNewFile["下载远程文件"]
        PushNewFile["上传本地文件"]
  end
    Start(["开始同步"]) --> PrepareSync["准备同步环境<br>1.创建远程基础目录<br>2.加载同步记录"]
    PrepareSync --> LoadStats["获取文件状态<br>1.遍历本地文件统计<br>2.遍历远程文件统计"]
    LoadStats --> SyncFolders
    SyncFolders -- 第一步:远程到本地 --> RemoteToLocal
    RemoteToLocal -- 本地存在 --> ValidateType
    ValidateType -- 类型不匹配 --> ErrorFolder
    RemoteToLocal -- 本地不存在但有记录 --> CheckRemoteFolderChanged
    CheckRemoteFolderChanged -- 远程已修改 --> CreateLocalDir
    CheckRemoteFolderChanged -- 远程未修改 --> CheckRemoteRemovable
    CheckRemoteRemovable -- 可以删除 --> RemoveRemoteFolder
    RemoteToLocal -- 完全无记录 --> CreateLocalFolder
    SyncFolders -- 第二步:本地到远程 --> LocalToRemote
    LocalToRemote -- 远程不存在 --> CheckLocalFolderRecord
    CheckLocalFolderRecord -- 有记录且本地变更 --> CreateRemoteFolder
    CheckLocalFolderRecord -- 有记录未变更 --> CheckLocalFolderRemovable
    CheckLocalFolderRemovable -- 可以删除 --> RemoveLocalFolder
    CheckLocalFolderRecord -- 无记录 --> CreateRemoteDirNew
    SyncFiles --> CheckSyncRecord & UpdateRecords["更新同步记录"]
    CheckSyncRecord -- 存在同步记录 --> ExistenceCheck
    ExistenceCheck -- 双端都存在 --> ChangeCheck
    ChangeCheck -- 双端都有变更 --> Conflict
    ChangeCheck -- 仅远程变更 --> Download
    ChangeCheck -- 仅本地变更 --> Upload
    ExistenceCheck -- 仅远程存在 --> RemoteOnlyCheck
    RemoteOnlyCheck -- 远程有变更 --> DownloadNew
    RemoteOnlyCheck -- 远程无变更 --> DeleteRemoteFile
    ExistenceCheck -- 仅本地存在 --> LocalOnlyCheck
    LocalOnlyCheck -- 本地有变更 --> UploadNew
    LocalOnlyCheck -- 本地无变更 --> DeleteLocalFile
    CheckSyncRecord -- 无同步记录 --> NoRecordCheck
    NoRecordCheck -- 双端都存在 --> ResolveConflict
    NoRecordCheck -- 仅远程存在 --> PullNewFile
    NoRecordCheck -- 仅本地存在 --> PushNewFile
    SyncFolders --> SyncFiles
    UpdateRecords --> End(["同步完成"])
```
