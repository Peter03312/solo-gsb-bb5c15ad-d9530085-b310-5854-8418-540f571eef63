// 示例园区路网（v1）
export const SAMPLE = {
  note: '示例园区路网 v1',
  nodes: [
    ['EAST', '东门'],
    ['WEST', '西门'],
    ['NORTH', '北门'],
    ['SQUARE', '中心广场'],
    ['LAKE', '临湖步道'],
    ['HALL', '报告厅'],
    ['LIB', '图书馆'],
    ['CANTEEN', '食堂'],
    ['DORM1', '1号宿舍'],
    ['DORM2', '2号宿舍'],
    ['HOSP', '医务室'],
    ['STAIRS_LK', '湖边台阶平台'],
    ['RAMPS', '无障碍坡道平台'],
    ['GARDEN', '百草园'],
    ['PARKING', '无障碍停车场'],
    ['STADIUM', '体育馆'],
    ['BRIDGE', '景观桥'],
    ['VIEW', '山顶观景台']
  ].map(([id, name]) => ({ id, name })),
  // has_steps: 1 表示该有向路段含台阶（轮椅不可用）
  edges: [
    { from: 'EAST', to: 'SQUARE', minutes: 5, has_steps: 0 },
    { from: 'WEST', to: 'SQUARE', minutes: 6, has_steps: 0 },
    { from: 'NORTH', to: 'SQUARE', minutes: 4, has_steps: 0 },
    { from: 'SQUARE', to: 'EAST', minutes: 5, has_steps: 0 },
    { from: 'SQUARE', to: 'WEST', minutes: 6, has_steps: 0 },
    { from: 'SQUARE', to: 'LAKE', minutes: 3, has_steps: 0 },
    { from: 'LAKE', to: 'SQUARE', minutes: 3, has_steps: 0 },
    { from: 'LAKE', to: 'STAIRS_LK', minutes: 4, has_steps: 0 },
    { from: 'STAIRS_LK', to: 'VIEW', minutes: 6, has_steps: 1 }, // 台阶近路
    { from: 'SQUARE', to: 'RAMPS', minutes: 7, has_steps: 0 },
    { from: 'RAMPS', to: 'VIEW', minutes: 9, has_steps: 0 },    // 无台阶绕行
    { from: 'SQUARE', to: 'HALL', minutes: 4, has_steps: 0 },
    { from: 'HALL', to: 'SQUARE', minutes: 4, has_steps: 0 },
    { from: 'HALL', to: 'LIB', minutes: 3, has_steps: 0 },
    { from: 'LIB', to: 'HALL', minutes: 3, has_steps: 0 },
    { from: 'LIB', to: 'CANTEEN', minutes: 5, has_steps: 0 },
    { from: 'CANTEEN', to: 'LIB', minutes: 5, has_steps: 0 },
    { from: 'SQUARE', to: 'DORM1', minutes: 6, has_steps: 0 },
    { from: 'DORM1', to: 'DORM2', minutes: 2, has_steps: 1 },   // 宿舍间连廊有台阶
    { from: 'DORM2', to: 'DORM1', minutes: 2, has_steps: 1 },
    { from: 'DORM1', to: 'HOSP', minutes: 4, has_steps: 0 },
    { from: 'HOSP', to: 'DORM1', minutes: 4, has_steps: 0 },
    { from: 'DORM1', to: 'SQUARE', minutes: 6, has_steps: 0 },
    { from: 'SQUARE', to: 'GARDEN', minutes: 8, has_steps: 0 },
    { from: 'GARDEN', to: 'PARKING', minutes: 3, has_steps: 0 },
    { from: 'PARKING', to: 'GARDEN', minutes: 3, has_steps: 0 },
    { from: 'PARKING', to: 'STADIUM', minutes: 5, has_steps: 0 },
    { from: 'STADIUM', to: 'PARKING', minutes: 5, has_steps: 0 },
    { from: 'STADIUM', to: 'BRIDGE', minutes: 6, has_steps: 0 },
    { from: 'BRIDGE', to: 'STADIUM', minutes: 6, has_steps: 0 },
    { from: 'BRIDGE', to: 'VIEW', minutes: 7, has_steps: 0 },
    { from: 'VIEW', to: 'BRIDGE', minutes: 7, has_steps: 0 },
    { from: 'VIEW', to: 'RAMPS', minutes: 9, has_steps: 0 },
    { from: 'RAMPS', to: 'SQUARE', minutes: 7, has_steps: 0 }
  ]
};
