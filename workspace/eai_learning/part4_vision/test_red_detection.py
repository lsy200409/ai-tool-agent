#!/usr/bin/env python3
"""
最小测试：加载红色球体，测试颜色检测
"""

import pybullet as p
import pybullet_data
import numpy as np
import cv2
import time
import os

# 连接 PyBullet
client = p.connect(p.GUI)
p.setAdditionalSearchPath(pybullet_data.getDataPath())
p.setGravity(0, 0, -9.8)
p.loadURDF("plane.urdf")

# 在非常开阔的位置加载红色球体（远离机械臂）
print("加载红色球体...")
ball = p.loadURDF(
    "sphere2red.urdf",  # 红色球体
    [0.8, 0.0, 0.1],    # 位置：右前方
    [0, 0, 0, 1],
    useFixedBase=True
)
print("✅ 红色球体加载在 (0.8, 0.0, 0.1)")

# 设置相机，对准球体
camera_pos = [0.8, -0.5, 0.3]
camera_target = [0.8, 0.0, 0.1]
width, height = 320, 240
view_matrix = p.computeViewMatrix(camera_pos, camera_target, [0, 0, 1])
proj_matrix = p.computeProjectionMatrixFOV(60, width/height, 0.01, 2.0)

print("\n开始实时检测... 按 ESC 退出\n")

cv2.namedWindow("Camera View", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Camera View", 640, 480)

# HSV 红色阈值（极宽松）
red_lower1 = np.array([0, 80, 80])
red_upper1 = np.array([15, 255, 255])
red_lower2 = np.array([155, 80, 80])
red_upper2 = np.array([180, 255, 255])

frame_count = 0

while True:
    # 获取图像
    img = p.getCameraImage(width, height, view_matrix, proj_matrix)
    rgb = np.array(img[2], dtype=np.uint8).reshape(height, width, 4)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
    
    # HSV 检测红色
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask1 = cv2.inRange(hsv, red_lower1, red_upper1)
    mask2 = cv2.inRange(hsv, red_lower2, red_upper2)
    mask = cv2.bitwise_or(mask1, mask2)
    
    # 形态学
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.erode(mask, kernel, iterations=1)
    mask = cv2.dilate(mask, kernel, iterations=2)
    
    # 查找轮廓
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    center = None
    if contours:
        largest = max(contours, key=cv2.contourArea)
        if cv2.contourArea(largest) > 50:
            M = cv2.moments(largest)
            if M['m00'] != 0:
                cx = int(M['m10'] / M['m00'])
                cy = int(M['m01'] / M['m00'])
                center = (cx, cy)
    
    # 绘制结果
    result = bgr.copy()
    if center:
        cx, cy = center
        cv2.circle(result, (cx, cy), 15, (0, 255, 0), 3)
        cv2.putText(result, f"RED! ({cx}, {cy})", (cx-80, cy-30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        print(f"✅ 检测到红色! ({cx}, {cy})")
    else:
        frame_count += 1
        if frame_count % 30 == 0:
            print("⏳ 未检测到红色...")
    
    # 显示掩码（调试用）
    mask_vis = cv2.resize(mask, (160, 120))
    mask_colored = cv2.cvtColor(mask_vis, cv2.COLOR_GRAY2BGR)
    result[120:240, 160:320] = mask_colored
    
    cv2.imshow("Camera View", result)
    p.stepSimulation()
    time.sleep(1/240)
    
    if cv2.waitKey(1) & 0xFF == 27:
        break

p.disconnect()
cv2.destroyAllWindows()
print("\n测试结束")
