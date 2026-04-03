---
name: dreamina-cli
version: 1.0.0
description: "即梦 CLI 命令速查 - 文生图、文生视频、图生图、图生视频生成能力"
---

# 即梦 CLI 命令速查

## 登录相关

```bash
dreamina login                    # 登录（自动拉起浏览器）
dreamina login --debug            # 调试模式登录
dreamina relogin                  # 重新登录
dreamina logout                   # 退出登录
dreamina user_credit              # 查询用户余额
```

## 文生图 (text2image)

```bash
dreamina text2image \
  --prompt="一只戴墨镜的橘猫" \
  --ratio=1:1 \
  --resolution_type=2k \
  --poll=30
```

**常用参数：**
- `--prompt`：生成提示词（必填）
- `--ratio`：图片比例（如 1:1, 16:9, 9:16）
- `--resolution_type`：分辨率（如 2k, 4k）
- `--poll`：轮询等待秒数

## 文生视频 (text2video)

```bash
dreamina text2video \
  --prompt="镜头推进，一只橘猫从沙发上跳下来" \
  --duration=5 \
  --ratio=16:9 \
  --video_resolution=720P \
  --poll=30
```

**常用参数：**
- `--prompt`：生成提示词（必填）
- `--duration`：视频时长（秒）
- `--ratio`：视频比例
- `--video_resolution`：视频分辨率（如 720P, 1080P）
- `--poll`：轮询等待秒数

## 图生图 (image2image)

```bash
dreamina image2image \
  --images ./input.png \
  --prompt="改成水彩风格" \
  --resolution_type=2k \
  --poll=30
```

**常用参数：**
- `--images`：输入图片路径（必填）
- `--prompt`：风格转换提示词（必填）
- `--resolution_type`：输出分辨率
- `--poll`：轮询等待秒数

## 图生视频 (image2video)

```bash
dreamina image2video \
  --image ./first_frame.png \
  --prompt="镜头慢慢推近" \
  --duration=5 \
  --poll=30
```

**常用参数：**
- `--image`：输入首帧图片路径（必填）
- `--prompt`：视频运动描述（必填）
- `--duration`：视频时长（秒）
- `--poll`：轮询等待秒数

## 任务查询与管理

```bash
# 查询任务结果
dreamina query_result --submit_id=<submit_id>

# 查询并下载到指定目录
dreamina query_result --submit_id=<submit_id> --download_dir=./downloads

# 查看所有历史任务
dreamina list_task

# 查看成功的任务
dreamina list_task --gen_status=success

# 根据 submit_id 筛选
dreamina list_task --submit_id=<submit_id>
```

## 通用参数说明

- `--poll=<秒数>`：提交后自动轮询等待结果，每秒查询1次，最多等待指定秒数
