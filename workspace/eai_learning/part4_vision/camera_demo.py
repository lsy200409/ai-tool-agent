#!/usr/bin/env python3
"""
PyBullet + OpenCV 仿真视觉检测演示
功能：从仿真相机获取图像，用 OpenCV 检测红色物体并输出坐标
"""

import pybullet as p
import pybullet_data
import numpy as np
import cv2
import time
import os


class BulletSim:
    """PyBullet 仿真环境管理"""
    
    def __init__(self, gui=True):
        self.gui = gui
        self.client = None
        self.robot_id = None
        self.target_id = None
        # 相机位置调整：正对球体
        self.camera_pos = [0.6, -0.4, 0.3]
        self.camera_target = [0.6, 0.2, 0.1]
        
    def connect(self):
        """连接仿真环境"""
        if self.gui:
            self.client = p.connect(p.GUI)
        else:
            self.client = p.connect(p.DIRECT)
        
        data_path = pybullet_data.getDataPath()
        p.setAdditionalSearchPath(data_path)
        p.setGravity(0, 0, -9.8)
        
        p.loadURDF("plane.urdf")
        
        # 加载 Franka Panda 机械臂（移到左侧，给球体让位置）
        robot_path = os.path.join(data_path, "franka_panda", "panda.urdf")
        print(f"加载机械臂: {robot_path}")
        self.robot_id = p.loadURDF(
            robot_path, 
            [-0.3, 0, 0],  # 向左移 0.3m，给球体腾出空间
            p.getQuaternionFromEuler([0, 0, 0]),
            useFixedBase=True
        )
        print("✅ 机械臂加载成功")
        
        # ========== 加载一个大红色球体，放在开阔位置 ==========
        # sphere2.urdf 是更大的球体（半径约 0.1m）
        self.target_id = p.loadURDF(
            "sphere2.urdf",  # 用更大的球体
            [0.6, 0.2, 0.1],  # 在机械臂右前方
            p.getQuaternionFromEuler([0, 0, 0]),
            useFixedBase=True
        )
        print("✅ 红色大球体加载成功（已固定，位置: 0.6, 0.2, 0.1）")
        
        self._setup_camera()
        return self.client
    
    def _setup_camera(self):
        self.camera_width = 640   # 提高分辨率，看得更清楚
        self.camera_height = 480
        self.fov = 60
        self.near = 0.01
        self.far = 2.0
        self.view_matrix = p.computeViewMatrix(
            self.camera_pos, self.camera_target, [0, 0, 1]
        )
        self.proj_matrix = p.computeProjectionMatrixFOV(
            self.fov, self.camera_width / self.camera_height, self.near, self.far
        )
    
    def get_camera_image(self):
        img = p.getCameraImage(
            self.camera_width, self.camera_height,
            self.view_matrix, self.proj_matrix
        )
        rgb = np.array(img[2], dtype=np.uint8).reshape(
            self.camera_height, self.camera_width, 4
        )
        return cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
    
    def step(self, dt=1/240):
        p.stepSimulation()
        time.sleep(dt)
    
    def get_target_position(self):
        if self.target_id is not None:
            pos, _ = p.getBasePositionAndOrientation(self.target_id)
            return np.array(pos)
        return None
    
    def disconnect(self):
        p.disconnect()


class ColorDetector:
    def __init__(self):
        # 更精确的红色阈值
        self.red_lower1 = np.array([0, 100, 100])
        self.red_upper1 = np.array([10, 255, 255])
        self.red_lower2 = np.array([160, 100, 100])
        self.red_upper2 = np.array([180, 255, 255])
    
    def detect_red(self, bgr_image):
        hsv = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2HSV)
        mask1 = cv2.inRange(hsv, self.red_lower1, self.red_upper1)
        mask2 = cv2.inRange(hsv, self.red_lower2, self.red_upper2)
        mask = cv2.bitwise_or(mask1, mask2)
        
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.erode(mask, kernel, iterations=1)
        mask = cv2.dilate(mask, kernel, iterations=2)
        
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            if cv2.contourArea(largest) > 100:  # 提高阈值，过滤噪点
                M = cv2.moments(largest)
                if M['m00'] != 0:
                    cx = int(M['m10'] / M['m00'])
                    cy = int(M['m01'] / M['m00'])
                    return (cx, cy), mask
        return None, mask
    
    def draw_detection(self, image, center, mask=None):
        result = image.copy()
        if center:
            cx, cy = center
            cv2.circle(result, (cx, cy), 15, (0, 255, 0), 3)
            cv2.putText(result, f"Target: ({cx}, {cy})", (cx-80, cy-30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        if mask is not None:
            mask_resized = cv2.resize(mask, (200, 150))
            mask_colored = cv2.cvtColor(mask_resized, cv2.COLOR_GRAY2BGR)
            result[330:480, 440:640] = mask_colored
        return result


def main():
    print("=" * 50)
    print(" PyBullet + OpenCV 颜色检测演示")
    print("=" * 50)
    print("\n[1] 启动 PyBullet 仿真...")
    sim = BulletSim(gui=True)
    sim.connect()
    print("[2] 初始化颜色检测器...")
    detector = ColorDetector()
    print("\n✅ 系统就绪！按 ESC 退出\n")
    print(" 球体位置: (0.6, 0.2, 0.1)  |  相机正对球体")
    print("   如果看不到红色球体，请检查仿真窗口是否显示正常\n")
    
    cv2.namedWindow("Camera View", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Camera View", 800, 600)
    
    frame_count = 0
    try:
        while True:
            frame = sim.get_camera_image()
            center, mask = detector.detect_red(frame)
            result = detector.draw_detection(frame, center, mask)
            
            if center:
                print(f"✅ 检测到红色! 像素坐标 ({center[0]}, {center[1]})")
                pos = sim.get_target_position()
                if pos is not None:
                    print(f"   世界坐标: ({pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f})")
            else:
                frame_count += 1
                if frame_count % 30 == 0:
                    print("⏳ 等待检测红色物体... (球体应该在 (0.6, 0.2, 0.1) 位置)")
            
            cv2.imshow("Camera View", result)
            sim.step()
            
            key = cv2.waitKey(1) & 0xFF
            if key == 27:
                break
                
    except KeyboardInterrupt:
        print("\n用户中断")
    finally:
        sim.disconnect()
        cv2.destroyAllWindows()
        print("仿真已关闭")


if __name__ == "__main__":
    main()
