let canvas = document.querySelector("#canvas");
let ctx = canvas.getContext("2d");
canvas.style.width = window.innerWidth + "px";
canvas.style.height = window.innerHeight + "px";
let canvasDivision = 5;
if (ctx.roundRect === undefined) ctx.roundRect = ctx.rect;

let [cos, sin] = [Math.cos.bind(Math), Math.sin.bind(Math)];

let gameState = "menu";

let playerVel = null, playerRadius = null, gravity = null, jumpSpeed = null, step = null, accelFactor = null, FOV = null, trueFOV = null, mouseMovement = null, hp = null, showFPS = null, frameBounds = null, skyboxParallax = null, cameraDistance = null, camMinimum = null, lightingVector = null, shadeStrength = null, shadeBase = null, fogFactor = null, aimLine = null, sway = null, timer = null, currentLevel = null;
let dragging = null, dragDistance = null, stopped = null, dragCap = null, fallingThresholds = null, score = null, holeGravity = null, friction = null, won = null;
let mapBoundaries = null;
let gameActive = false;

let player = null;

function resetValues() {
  playerVel = [0, 0, 0]; playerRadius = .25; hp = 100; showFPS = true; showHits = true;
  jumpSpeed = 1.5; gravity = .1, step = 0.1; accelFactor = .4; trueFOV = FOV = [2.012742, Math.PI/2.2]; cameraDistance = 5.4; camMinimum = Math.PI/4; frameBounds = [10, 14]; mouseMovement = [0, 0];  skyboxParallax = .1; lightingVector = [-.5, -1.5, -1]; [0, -1, 0]; shadeStrength = 0.5; shadeBase = .5; fogFactor = 5;
  stopped = true; dragging = false; dragDistance = 0; timer = 0; dragCap = 1.25; fallingThresholds = [-10, -50]; holeGravity = 1/50; score = 0; friction = .9; won = false;
  shapes = [];
  player = copyShape(playerTemplate);if (cameraDistance > 0) shapes.push(player); 
  map = copyShape(currentLevel); shapes.push(map);
  skybox = copyShape(skyboxTemplate); shapes.push(skybox);
  aimLine = new Shape([]); shapes.push(aimLine);
  gameActive = true;
  camAngle = [0, 0];
  camAngle[1] -= Math.PI/6;
  player.move([0, playerRadius, 0]);
}

function mapWhilePreserve(list, fn) {
  for (let i = 0; i < list.length; i++) {
    list[i] = fn(list[i]);
  }
  return list;
}
function interpolateDepth(d1, d2, distAlong, fullDist) {
  return (d2-d1)*(distAlong/fullDist)+d1;
}
function interpolateCoords(p1, p2, pt, uv1, uv2, d1, d2, d3) {
  if (Math.abs(p1[0] - p2[0]) < 0.01 && Math.abs(p1[1] - p2[1]) < 0.01) return uv1;
  let screenSpaceRatio = (1-distance(p1, pt)/distance(p1, p2));
  let x = (uv1[0]/d1 * screenSpaceRatio + uv2[0]/d2 * (1-screenSpaceRatio)) * d3;
  let y = (uv1[1]/d1 * screenSpaceRatio + uv2[1]/d2 * (1-screenSpaceRatio)) * d3;
  return [x, y];
}
function interpolateVtn(pos1, pos2, pos, vtn1, vtn2, d1, d2, d3) {
  let screenSpaceRatio = (1-distance(pos1, pos)/distance(pos1, pos2));
  if (screenSpaceRatio > .99) return vtn1; if (screenSpaceRatio < .01) return vtn2;
  //return times(plus(times(vtn1, screenSpaceRatio/d1), times(vtn2, (1-screenSpaceRatio)/d2)), d3);
  return vtn1.map((n, idx) => (n/d1 * screenSpaceRatio + vtn2[idx]/d2 * (1-screenSpaceRatio)) * d3);
  //return vtn1.map((n, idx) => (n * screenSpaceRatio + vtn2[idx] * (1-screenSpaceRatio)));
}

//the following functions use a custom rasterizer and a zbuffer for rendering, see the following:
//https://en.wikipedia.org/wiki/Z-buffering
//http://www.sunshine2k.de/coding/java/TriangleRasterization/TriangleRasterization.html
//https://stackoverflow.com/a/8290734/15938577
//https://en.wikipedia.org/wiki/Texture_mapping#Perspective_correctness
//https://en.wikipedia.org/wiki/Phong_shading#Phong_interpolation
function drawPixel(canvasData, depthBuffer, x, y, r, g, b, depth, viewmodelBuffer, viewmodel=false) {
  if (x < 0 || x >= canvas.width || y < 0 || y > canvas.height) return;
  var index = (x + y * canvas.width) * 4;  
  if ((((!viewmodel)||viewmodelBuffer[index]) && (depthBuffer[index] !== undefined && depthBuffer[index] < depth)) || (viewmodelBuffer[index]===true && !viewmodel) || depth < 0) return;
  depthBuffer[index] = depth;
  if (viewmodel) viewmodelBuffer[index] = true;
  let fogIncrease = fogFactor*Math.sqrt(Math.min(depth, 20));
  canvasData.data[index + 0] = Math.min(r + fogIncrease, 255);
  canvasData.data[index + 1] = Math.min(g + fogIncrease, 255);
  canvasData.data[index + 2] = Math.min(b + fogIncrease, 255);
  canvasData.data[index + 3] = 255;
}
function drawTopTri(p1, p2, p3, canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel=false) {
  let slope1 = (p2[0]-p1[0])/(p2[1]-p1[1]);
  let slope2 = (p3[0]-p1[0])/(p3[1]-p1[1]);
  let switched = slope1 > slope2;
  if (switched) [slope1, slope2] = [slope2, slope1];
  let curXs = [p1[0], p1[0]];
  let depths = [p1.depth, p1.depth];
  if (p1[1] < 0) curXs = [curXs[0]+slope1*-p1[1], curXs[1]+slope2*-p1[1]];
  for (let y = Math.max(0, (p1[1])); y <= Math.min(canvas.height, p2[1]); y++) {
    if (y !== p1[1]) {
      depths = [interpolateDepth(p1.depth, p2.depth, y - (p1[1]), p2[1]-(p1[1])), 
      interpolateDepth(p1.depth, p3.depth, y - (p1[1]), p3[1]-(p1[1]))];
      if (switched) depths = [depths[1], depths[0]];
    }
    if (y >= 0 && y <= canvas.height) {
      let coords1, coords2;
      if (mtl.texture) {
        coords1 = interpolateCoords(p1, (switched ? p3 : p2), [curXs[0], y], p1.coords, (switched ? p3 : p2).coords, 1/p1.depth, 1/(switched ? p3 : p2).depth, 1/depths[0]);
        coords2 = interpolateCoords(p1, (switched ? p2 : p3), [curXs[1], y], p1.coords, (switched ? p2 : p3).coords, 1/p1.depth, 1/(switched ? p2 : p3).depth, 1/depths[1]);
      }
      if (p1.vtn !== undefined) {
        vtn1 = interpolateVtn(p1, (switched ? p3 : p2), [curXs[0], y], p1.vtn, (switched ? p3 : p2).vtn, 1/p1.depth, 1/(switched ? p3 : p2).depth, 1/depths[0]);
        vtn2 = interpolateVtn(p1, (switched ? p2 : p3), [curXs[1], y], p1.vtn, (switched ? p2 : p3).vtn, 1/p1.depth, 1/(switched ? p2 : p3).depth, 1/depths[0]);
      }
      for (let x = Math.max(curXs[0], 0); x <= (Math.min(curXs[1], canvas.width)); x++) {
        let depth = 1/(curXs[1] === curXs[0] ? depths[0] : interpolateDepth(depths[0], depths[1], x-curXs[0], curXs[1]-curXs[0]));
        let coordsFinal;
        if (mtl.texture) coordsFinal = interpolateCoords([curXs[0], y], [curXs[1], y], [x, y], coords1, coords2, 1/depths[0], 1/depths[1], depth);
        
        try {
          let imageCoords;
          if (mtl.texture) {
            coordsFinal = [(Math.ceil(coordsFinal[0] * mtl[0].length)), -Math.floor(coordsFinal[1] * mtl.length)];
            if (coordsFinal[1] < 0) coordsFinal[1] += Math.ceil((mtl.length/(Math.abs(coordsFinal[1]))))*mtl.length+mtl.length;
            if (coordsFinal[0] < 0) coordsFinal[0] += Math.ceil((mtl[0].length/(Math.abs(coordsFinal[0]))))*mtl[0].length+mtl[0].length;
            imageCoords = mtl[coordsFinal[1]%mtl.length][coordsFinal[0]%mtl[1].length].map(n => n*mtl.lighting);
          } else imageCoords = mtl;
          if (p1.vtn !== undefined) {
            let finalLightingVector = (x === curXs[0] ? vtn1 : (x === curXs[1] ? vtn2 : unit(interpolateVtn([curXs[0], y], [curXs[1], y], [x, y], vtn1, vtn2, 1/depths[0], 1/depths[1], depth))));
            let dot = dotProduct(finalLightingVector, unit(lightingVector));
            imageCoords = imageCoords.map(n => n*getLighting(dot));
          }
          //if (y === p2[1] || x === curXs[0] || x >= curXs[1] - 2) imageCoords = [0, 255, 0];
          drawPixel(canvasData, depthBuffer, Math.round(x), Math.round(y), imageCoords[0], imageCoords[1], imageCoords[2], depth, viewmodelBuffer, viewmodel
          );
        } catch(e) {console.log(e, coordsFinal, coords1, coords2)}
      }
      
    }
    curXs[0] += slope1;
    curXs[1] += slope2;
  }
}

function drawBottomTri(p1, p2, p3, canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel=false) {
  let slope1 = (p2[0]-p1[0])/(p2[1]-p1[1]);
  let slope2 = (p3[0]-p1[0])/(p3[1]-p1[1]);
  let switched = slope1 < slope2;
  if (switched) [slope1, slope2] = [slope2, slope1];
  let curXs = [p1[0], p1[0]];
  let depths = [p1.depth, p1.depth];
  if (p1[1] < 0) curXs = [curXs[0]+slope1*-p1[1], curXs[1]+slope2*-p1[1]];
  for (let y = Math.max((p1[1]), 0); y >= Math.max(0, p2[1]); y--) {
    if (y >= 0 && y <= canvas.height) {
      if (y !== p1[1]) {
        depths = [interpolateDepth(p1.depth, p2.depth, y - (p1[1]), p2[1]-(p1[1])), 
        interpolateDepth(p1.depth, p3.depth, y - (p1[1]), p3[1]-(p1[1]))];
        if (switched) depths = [depths[1], depths[0]];
      }
      if (curXs[1]-curXs[0]>=0) {
        let coords1, coords2, vtn1, vtn2;
        if (mtl.texture) {
          coords1 = interpolateCoords(p1, (switched ? p3 : p2), [curXs[0], y], p1.coords, (switched ? p3 : p2).coords, 1/p1.depth, 1/(switched ? p3 : p2).depth, 1/depths[0]);
          coords2 = interpolateCoords(p1, (switched ? p2 : p3), [curXs[1], y], p1.coords, (switched ? p2 : p3).coords, 1/p1.depth, 1/(switched ? p2 : p3).depth, 1/depths[1]);
        }
        if (p1.vtn !== undefined) {
          vtn1 = interpolateVtn(p1, (switched ? p3 : p2), [curXs[0], y], p1.vtn, (switched ? p3 : p2).vtn, 1/p1.depth, 1/(switched ? p3 : p2).depth, 1/depths[0]);
          vtn2 = interpolateVtn(p1, (switched ? p2 : p3), [curXs[1], y], p1.vtn, (switched ? p2 : p3).vtn, 1/p1.depth, 1/(switched ? p2 : p3).depth, 1/depths[0]);
        }
        for (let x = Math.max((curXs[0]), 0); x <= (Math.min(curXs[1], canvas.width)); x++) {
          let depth = 1/(curXs[1] === curXs[0] ? depths[0] : interpolateDepth(depths[0], depths[1], x-curXs[0], curXs[1]-curXs[0]));
          let coordsFinal;
          if (mtl.texture) coordsFinal = interpolateCoords([curXs[0], y], [curXs[1], y], [x, y], coords1, coords2, 1/depths[0], 1/depths[1], depth);
          try {
            let imageCoords;
            if (mtl.texture) {
              coordsFinal = [(Math.ceil(coordsFinal[0] * mtl[0].length)), -Math.floor(coordsFinal[1] * mtl.length)];
              if (coordsFinal[1] < 0) coordsFinal[1] += Math.ceil((mtl.length/(Math.abs(coordsFinal[1]))))*mtl.length+mtl.length;
              if (coordsFinal[0] < 0) coordsFinal[0] += Math.ceil((mtl[0].length/(Math.abs(coordsFinal[0]))))*mtl[0].length+mtl[0].length;
              imageCoords = mtl[coordsFinal[1]%mtl.length][coordsFinal[0]%mtl[1].length].map(n => n*mtl.lighting);
            } else imageCoords = mtl;
            if (p1.vtn !== undefined) {
              let finalLightingVector = (x === curXs[0] ? vtn1 : (x === curXs[1] ? vtn2 : unit(interpolateVtn([curXs[0], y], [curXs[1], y], [x, y], vtn1, vtn2, 1/depths[0], 1/depths[1], depth))));
              let dot = dotProduct(finalLightingVector, unit(lightingVector));
              imageCoords = imageCoords.map(n => n*getLighting(dot));
            }
            //if (y === p2[1] || x === curXs[0] || x >= curXs[1] - 2) imageCoords = [0, 255, 0];
            drawPixel(canvasData, depthBuffer, Math.round(x), Math.round(y), imageCoords[0], imageCoords[1], imageCoords[2], 
            depth, viewmodelBuffer, viewmodel
          );
          } catch(e) {console.log(e)}
        }
      }
    }
    curXs[0] -= slope1;
    curXs[1] -= slope2; 
  }
}
function drawTri(p1, p2, p3, canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel=false) {
  let pts = [p1, p2, p3].map(pt => mapWhilePreserve(pt, Math.round));
  if (pts.some(pt => pt.some(n => Number.isNaN(n)||!Number.isFinite(n)))) return;
  pts.forEach((pt, idx) => pt.coords = [p1, p2, p3][idx].coords);
  pts.forEach((pt, idx) => pt.vtn = [p1, p2, p3][idx].vtn);
  let ptOutsideList = [];
  for (let pt of pts) {
    let outside = [];
    if (pt[0] < 0) outside.push(1);
    if (pt[0] > canvas.width) outside.push(2);
    if (pt[1] < 0) outside.push(3);
    if (pt[1] > canvas.height) outside.push(4);
    ptOutsideList.push(outside)
  }
  if (ptOutsideList.every(outside => outside.length > 0) && ptOutsideList.every(outside => outside.every(location => ptOutsideList.every(list => list.includes(location))))) return;
  pts.sort((a, b) => a[1]-b[1]);
  
  if (pts[1][1] === pts[2][1]) {drawTopTri(pts[0], pts[1], pts[2], canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel);return;}
  if (pts[0][1] === pts[1][1]) {drawBottomTri(pts[2], pts[1], pts[0], canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel);return;}
  let p4 = [pts[0][0] + ((pts[1][1] - pts[0][1]) / (pts[2][1] - pts[0][1])) * (pts[2][0] - pts[0][0]), pts[1][1]];
  p4.depth = interpolateDepth(pts[0].depth, pts[2].depth, p4[1]-pts[0][1], pts[2][1]-pts[0][1]);
  if (mtl.texture) p4.coords = interpolateCoords(pts[0], pts[2], p4, pts[0].coords, pts[2].coords, 1/pts[0].depth, 1/pts[2].depth, 1/p4.depth);
  if (pts[0].vtn !== undefined) {p4.vtn = interpolateVtn(pts[0], pts[2], p4, pts[0].vtn, pts[2].vtn, 1/pts[0].depth, 1/pts[2].depth, 1/p4.depth);}

  drawTopTri(pts[0], pts[1], p4, canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel);
  drawBottomTri(pts[2], p4, pts[1], canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel);
}
function drawPoly(pts, canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel=false, lighting) {
  mtl.lighting = lighting;
  for (let i = 0; i < pts.length-2; i++) {
    drawTri(pts[0], pts[i+1], pts[i+2], canvasData, depthBuffer, mtl, viewmodelBuffer, viewmodel);
  }
}

//basic matrix class for 3d projection and rotation
class matrix {
  constructor(list) {
    this.list = list;
    this.dim = [this.list.length, this.list[0].length];
  }
  multiply(other) {
    if (other.dim[0] !== this.dim[1]) return false;
    let newMatrix = matrix.dimensions(this.dim[0], other.dim[1]);
    for (let i = 0; i < this.dim[0]; i++) {
      for (let j = 0; j < other.dim[1]; j++) {
      	newMatrix.list[i][j] = this.list[i].map((el, idx) => el*other.list[idx][j]).reduce((a, b)=>a+b);
      }
    }
    return newMatrix;
  }
  static from(list) {return new matrix(list);}
  static dimensions(r, c) {
    let list = [];
    for (let i = 0; i < r; i++) {
      list.push((new Array(c)).fill(0));
    }
    return new matrix(list);
  }
  static identity(n) {
    let list = [];
    for (let i = 0; i < n; i++) {
      list.push([]);
      for (let j = 0; j < n; j++) {
        if (i === j) list.at(-1).push(1);
        else list.at(-1).push(0);
      }
    }
    return new matrix(list);
  }
}

//a custom class for 3d objects that allows movement and rotation
class Shape {
  constructor(polys) {
    this.polys = polys;
    this.offset = [0, 0, 0];
    this.rotate = [0, 0, 0];
    this.speed = 0;
    this.rotatedPolys = null;
  }
  move(offset) {
    this.offset = this.offset.map((el, idx) => el+offset[idx]);
    this.polys = this.polys.map(poly => {
      let newPoly = poly.map(pt => pt.map((el, idx) => Number(el)+offset[idx]));
      newPoly.mtl = poly.mtl;
      newPoly.cross = poly.cross;
      newPoly.forEach((pt, idx) => pt.coords = poly[idx].coords);
      newPoly.forEach((pt, idx) => pt.vtn = poly[idx].vtn);
      return newPoly;
    });
    if (this.rotatedPolys !== null) {
      this.rotatedPolys = this.rotatedPolys.map(poly => {
        let newPoly = poly.map(pt => pt.map((el, idx) => Number(el)+offset[idx]));
        newPoly.mtl = poly.mtl;
        newPoly.cross = poly.cross;
        newPoly.forEach((pt, idx) => pt.coords = poly[idx].coords);
        newPoly.forEach((pt, idx) => pt.vtn = poly[idx].vtn);
        return newPoly;
      });
    }
  }
  moveInDirection(dist) {
    this.move(times(vecFromAngle(this.rotate), dist));
  }
  turn(direction) {
    this.rotate = this.rotate.map((n, idx) => n + direction[idx]);
    direction = this.rotate;
    let rotationX = matrix.from([[Math.cos(direction[2]), -Math.sin(direction[2]), 0], [Math.sin(direction[2]), Math.cos(direction[2]), 0], [0, 0, 1]]);
    let rotationY = matrix.from([[Math.cos(direction[0]), 0, Math.sin(-direction[0])], [0, 1, 0], [Math.sin(direction[0]), 0, Math.cos(direction[0])]]);
    let rotationZ = matrix.from([[1, 0, 0], [0, Math.cos(-direction[1]), -Math.sin(-direction[1])], [0, Math.sin(-direction[1]), Math.cos(-direction[1])]]);
    let fullRotation = rotationY.multiply(rotationZ).multiply(rotationX);
    
    this.rotatedPolys = this.polys.map(poly => {
      let pts = poly.map(pt => [[pt[0]-this.offset[0]], [pt[1]-this.offset[1]], [pt[2]-this.offset[2]]]);
      pts = pts.map(pt => (fullRotation.multiply(matrix.from(pt)).list));
      pts = pts.map(pt => [[Number(pt[0][0]+this.offset[0])], [Number(pt[1][0]+this.offset[1])], [Number(pt[2][0]+this.offset[2])]]);
      let newPoly = pts;
      newPoly.mtl = poly.mtl;
      newPoly.forEach((pt, idx) => pt.coords = poly[idx].coords);
      return newPoly;
    });
    this.updateCrossProducts(true);
    this.updateVertexNormals();
  }
  resetTurn() {
    this.rotatedPolys = null;
    this.rotate = [0, 0, 0];
  }
  updateCrossProducts(rotated=false) {
    for (let poly of rotated ? this.rotatedPolys : this.polys) {
      poly.cross = crossPoly(poly);
    }
  }
  updateVertexNormals() {
    for (let poly of this.polys) {
      for (let vertex of poly) {
        vertex.vtn = unit(minus(vertex, this.offset));
      }
    }
    if (this.rotatedPolys !== null) {
      for (let poly of this.rotatedPolys) {
        for (let vertex of poly) {
          vertex.vtn = unit(minus(vertex, this.offset));
        }
      }
    }
  }
}

//a lot of utility functions that were created out of necessity
function crossProduct(vec1, vec2) {
  return (matrix.from([[0, -vec1[2], vec1[1]], [vec1[2], 0, -vec1[0]], [-vec1[1], vec1[0], 0]])).multiply(matrix.from([[vec2[0]], [vec2[1]], [vec2[2]]]));
}
function crossPoly(pts) {
  return unit(crossProduct([pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]], [pts[2][0]-pts[1][0], pts[2][1]-pts[1][1], pts[2][2]-pts[1][2]]).list.flat());
}
function dotProduct(vec1, vec2) {
  return vec1.reduce((a, b, idx) => a+b*vec2[idx], 0);
}
function plus(pt1, pt2) {
  return pt1.map((n, idx) => Number(n)+Number(pt2[idx]));
}
function minus(pt1, pt2) {
  return pt1.map((n, idx) => n-pt2[idx]);
}
function times(pt1, x) {
  return pt1.map((n) => n*x);
}
function angleBetween(pt1, center, pt2) {
  return Math.acos(Math.min(1, Math.max(-1, dotProduct(unit(minus(pt1, center)), unit(minus(pt2, center))))));
}
function center(list) {
  return list.reduce((a, b) => a.map((el, idx) => el+b[idx]/list.length), [0,0,0]);
}
function unit(list) {
  let dist = list.reduce((a, b) => a+b**2, 0)**0.5;
  if (dist === 0) return list;
  return list.map(n => n/dist);
}
function distance(pt1, pt2) {
  if (pt2 === undefined) pt2 = [];
  return Math.sqrt(pt1.map((n, idx) => (n-(pt2[idx]||0))**2).reduce((a, b) => a+b));
}
function vecFromAngle(angle) {
  return [-Math.sin(angle[0])*Math.cos(angle[1]), Math.sin(angle[1]), Math.cos(angle[0])*Math.cos(angle[1])];
}
function getLighting(dot) {
  let angle = Math.acos(dot);
  return (shadeBase+angle/Math.PI*2*shadeStrength);
}
function getNewFOV(fov, horizontal) {
  /*width / tan(fov_x/2) = height / tan(fov_y/2) */
  let heightToWidthRatio = Math.tan(fov[1]/2)/Math.tan(fov[0]/2);
  return [horizontal, 2 * Math.atan(Math.tan(horizontal/2) * heightToWidthRatio)];
}
function deviate(angle, bloom) {
  let bloomAngle = Math.random()*2*Math.PI, bloomWidth = (Math.random()-.5)*bloom;
  return [angle[0] + Math.cos(bloomAngle)*bloomWidth/(Math.abs(Math.cos(camAngle[1]))),
    angle[1] + Math.sin(bloomAngle)*bloomWidth];
}
function leadAim(initPos, targetPos, speed, targetVel) {
  let collisionPos = targetPos, time = null;
  for (let i = 0; i < 5; i++) {
    time = Math.sqrt(collisionPos.map((n, idx) => (n-initPos[idx])**2).reduce((a, b) => a+b))/speed;
    collisionPos = targetPos.map((n, idx) => n+targetVel[idx]*time);
  }
  return [unit(collisionPos.map((n, idx) => n-initPos[idx])), collisionPos];
}
function distInDir(dirVec, init, pt) {
  if (init === null) init = [0, 0, 0];
  return dotProduct(unit(dirVec), pt.map((n, idx) => n-init[idx]));
}
//this function is the basis for all of the bullet and physics collisions - detect flat circle/3d tri collision
//assuming the circle and triangle are coplanar
//3 steps: 1, check if the point is within the triangle. 2, check if the radius is outside the triangle but the circle touches a vertex. 3, check if the radius is outside the triangle but the circle touches an edge
function ptHitsTri(pt, radius, tri, data) {
  if (data === undefined) data = {};
  let centroid = center(tri);
  let dist = Math.max(...tri.map(pt => distance(pt, centroid)));
  if (dist+radius < distance(pt, centroid)) return false;
  let firstpoint = tri.reduce((a, b) => angleBetween(a, centroid, pt) < angleBetween(b, centroid, pt) ? a : b);
  let previous = tri.at(tri.indexOf(firstpoint)-1);
  if (Math.abs(angleBetween(previous, centroid, firstpoint) - (angleBetween(previous, centroid, pt)+angleBetween(pt, centroid, firstpoint))) < 0.001) {
    secondpoint = previous;
  } else {
    secondpoint = tri.at(tri.indexOf(firstpoint)+1-tri.length);
  }
  let expectedDistance = Math.sin(angleBetween(centroid, firstpoint, secondpoint))*distance(centroid, firstpoint) / Math.sin(Math.PI-angleBetween(firstpoint, centroid, pt)-angleBetween(centroid, firstpoint, secondpoint));
  if (distance(centroid, pt) <= expectedDistance) {
    return data["vec"] ? times(data["poly"].cross, distInDir(data["poly"].cross, center(data["poly"]), data["sphereCenter"]) > 0 ? step : -step) : true;
  }
  if (radius === 0) return false;
  let distAlongSide = dotProduct(unit(minus(secondpoint, firstpoint)), minus(pt, firstpoint));
  if (distAlongSide < 0) {
    if (distance(firstpoint, pt) <= radius) return data["vec"] ? times(minus(data["sphereCenter"], firstpoint), step) : true;
  }
  let expectedOuterDistance = distance(firstpoint, pt) * Math.sin(angleBetween(pt, firstpoint, secondpoint));
  let distanceAlong = distance(firstpoint, pt) * Math.cos(angleBetween(pt, firstpoint, secondpoint))
  if (expectedOuterDistance <= radius) {
    return data["vec"] ? times(minus(data["sphereCenter"], plus(firstpoint, times(unit(minus(secondpoint, firstpoint)), distanceAlong))), step) : true;
  }
  return false;
}
//convert a sphere into a coplanar circle and check for collision
function sphereHitsPoly(sphereCenter, radius, poly, vec=false) {
  let trueCentroid = center(poly);
  let verticalDist = distInDir(poly.cross, trueCentroid, sphereCenter);
  if (Math.abs(verticalDist) < radius) {
    let crossSection = radius*Math.cos(Math.asin(Math.abs(verticalDist/radius)));
    if (poly.some(pt => distance(trueCentroid, pt) >= distance(trueCentroid, sphereCenter)-crossSection)) {
      return ptHitsTri(minus(sphereCenter, poly.cross.map(n => n*verticalDist)), crossSection, poly, {vec, sphereCenter, radius, poly});
    }
  }
  return false;
}
//find the angle against the cross product of the poly, find the distance along the ray that it should collide (the intersection between the polygon's plane and the ray), and check if the intersection lies on the polygon
function rayHitsPoly(start, poly, vector, maxDistance=Infinity) {
  vector = unit(vector);
  let centroid = center(poly);
  let dist = distInDir(poly.cross, centroid, start);
  let normal = dist < 0 ? poly.cross : times(poly.cross, -1);
  let angle = Math.acos(dotProduct(vector, normal));
  if (angle >= Math.PI/2) {return false;}
  let distance = Math.abs(dist)/Math.cos(angle);
  if (distance > maxDistance) return false;
  let potentialCollision = plus(start, times(vector, distance));
  if (ptHitsTri(potentialCollision, 0, poly)) {
    return {collision: potentialCollision, distance: distance};
  }
  return false;
}
//find if a line of sight is unblocked
function lineOfSight(start, shapes, end) {
  let vec = minus(end, start);
  let dist = distance(vec);
  for (let shape of shapes) {
    for (let poly of shape.rotatedPolys || shape.polys) {
      let collision = rayHitsPoly(start, poly, vec, dist);
      if (collision) return false;
    }
  }
  return true;
}
//shoot a ray through a set of polygons and if it hits some, find the closest hit
function findRaycast(start, shapes, vector) {
  let closest = null;
  for (let shape of shapes) {
    for (let poly of shape.rotatedPolys || shape.polys) {
      let collision = rayHitsPoly(start, poly, vector);
      if (collision && (closest === null || collision.distance < closest.distance)) {
        closest = collision;
        closest.poly = poly;
        closest.shape = shape;
      }
    }
  }
  return closest;
}

let camFollow = null;

let points = [];

let shapes = [];

function circle(x, y, radius) {
  ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.fill();
  ctx.closePath();
}

let camAngle = [0, 0], camPos = [0, 0, 0];

//convert a 3D coordinate into a 2D screen space coordinate, based on the FOV
function project(point) {
  return [-point[0]/(point[2])*Math.tan(Math.PI/2-FOV[0]/2)/2*canvas.width+canvas.width/2, -point[1]/Math.abs(point[2])*Math.tan(Math.PI/2-FOV[1]/2)/2*canvas.height+canvas.height/2];
}
function clear(canvas) {
	let ctx = canvas.getContext("2d");
	ctx.beginPath();
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.closePath();
}

//keep track of the last frame tick to monitor FPS
let lastTime = performance.now();

setInterval(function() {
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  canvas.style.cursor = "auto";
  if (gameState === "playing" && !isLoading && !won) {
    //if we were just playing and now we are not, we have just paused
    if (keys["p"] || document.pointerLockElement === null) gameState = "justPaused";
  }
  if (gameState === "playing" && !isLoading) {
    //dynamically maintain the resolution
    canvas.width = window.innerWidth/canvasDivision;
    canvas.height = window.innerHeight/canvasDivision;
    timer += 1;
    let cameraSpeed = 1;
    camFollow = player;
    if (camFollow === null) {} else {
      if (keys["r"] && !won) {
        keys["r"] = false;
        resetValues();
      }
      let camFollowVector = [Math.sin(camAngle[0]) * cameraDistance * Math.cos(camAngle[1]), - Math.sin(camAngle[1]) * cameraDistance + cameraDistance/5 + .3, - Math.cos(camAngle[0]) * cameraDistance * Math.cos(camAngle[1])];
      let cameraClipping = findRaycast([camFollow.offset[0], camFollow.offset[1]+playerRadius, camFollow.offset[2]], [map], camFollowVector);
      if (cameraClipping !== null) camFollowVector = plus(times(unit(camFollowVector), Math.min(cameraClipping.distance * .7, cameraDistance)), [0, playerRadius, 0]);
      camPos = plus(camFollow.offset, camFollowVector);
      if (!won) {
        if (distance(playerVel) < .02) {
          if (stopped === false) stopped = 0;
          else if (stopped !== true) {
            stopped += 1;
            if (stopped > 2) {stopped = true; playerVel = [0, 0, 0]; mouseDown = false;}
          }
        } else {stopped = false;}
          
        //physics (collisions)
        if (!stopped) {
          dragging = false;
          let physicsSteps = 30;
          for (let i = 0; i < physicsSteps; i++) {
            playerVel[1] -= gravity/physicsSteps;
            player.move(times(playerVel, 1/physicsSteps));
            for (let poly of map.polys) {
              let collides = sphereHitsPoly(player.offset, playerRadius, poly, true);
              if (collides !== false) {
                while (sphereHitsPoly(player.offset, playerRadius, poly)) {
                  player.move(times(unit(collides), .01));
                }
                collides = unit(collides);
                playerVel = times(minus(playerVel, times(collides, 2 * dotProduct(playerVel, collides))), friction);
                //^^^ https://math.stackexchange.com/questions/13261
                playerVel[1] *= .7;
              }
            }
            let hole = map.polys.filter(poly => poly.mtl === "hole")[0];
            if (hole !== undefined) {
              hole = center(hole);
              if (distance(player.offset, hole) < 1) {
                if (distance(player.offset, hole) < .5) {
                  player.move(minus(hole, player.offset));
                  player.move([0, playerRadius, 0]);
                  won = true;
                  if (document.pointerLockElement !== null) document.exitPointerLock();
                } else {
                  let vectorToHole = minus(hole, player.offset);
                  playerVel = plus(playerVel, times(vectorToHole, 1/distance(vectorToHole) * holeGravity));
                }
              }
            }
          }
        } 
        // draw the arrow for aiming, and launch the golf ball upon release
        else if (stopped === true) {
          if (mouseDown && !dragging) {dragging = true; dragDistance = 0; timer = 0;}
          if (dragging) {
            dragDistance = Math.min(Math.max(0, dragDistance + (mouseMovement[1] < 0 ? mouseMovement[1] * 2 : mouseMovement[1])), dragCap);
            if (shapes.includes(aimLine)) shapes.splice(shapes.indexOf(aimLine), 1);
            if (dragDistance > 0) {
              sway = Math.sin((timer-1) / 3) * .1 * Math.sqrt(dragDistance); 
              aimLine = new Shape([[[-.2*Math.sqrt(dragDistance), 0, 0], [.2*Math.sqrt(dragDistance), 0, 0], [.2*Math.sqrt(dragDistance), 0, dragDistance * 5], [-.2*Math.sqrt(dragDistance), 0, dragDistance * 5]],
              [[.4*Math.sqrt(dragDistance), 0, dragDistance * 5], [0, 0, 1.5*Math.sqrt(dragDistance) + 5*dragDistance], [-.4*Math.sqrt(dragDistance), 0, dragDistance * 5]]]);
              aimLine.polys.forEach(poly => poly.mtl = "red");
              aimLine.updateCrossProducts();
              aimLine.move(player.offset); aimLine.move([0, -.05, 0]);
              aimLine.turn([camAngle[0], 0, 0]);
              aimLine.moveInDirection(.3);
              aimLine.updateCrossProducts(true);
              aimLine.turn([sway, 0, 0]);
              aimLine.overallDepth = times(plus(aimLine.rotatedPolys[0][0], aimLine.rotatedPolys[0][1]), .5);
              shapes.push(aimLine);
            }
          }
          if (!mouseDown && dragging) {
            if (dragDistance > 0) {
              playerVel = times([-Math.sin(camAngle[0]+sway), 0, Math.cos(camAngle[0]+sway)], dragDistance * 3);
              if (shapes.includes(aimLine)) shapes.splice(shapes.indexOf(aimLine), 1);
              score += 1;
            }
            dragging = false;
          }
        }
      }
    }

    //camera rotation matrices - see https://en.wikipedia.org/wiki/Rotation_matrix
    let yaw = matrix.from([[Math.cos(camAngle[0]), -Math.sin(camAngle[0]), 0], [Math.sin(camAngle[0]), Math.cos(camAngle[0]), 0], [0, 0, 1]]);
    let roll = matrix.from([[1, 0, 0], [0, Math.cos(camAngle[1]), -Math.sin(camAngle[1])], [0, Math.sin(camAngle[1]), Math.cos(camAngle[1])]]);
    let pitch = matrix.from([[Math.cos(camAngle[0]), 0, Math.sin(camAngle[0])], [0, 1, 0], [-Math.sin(camAngle[0]), 0, Math.cos(camAngle[0])]]);
    let transformCamera = roll.multiply(pitch);
    points = []

    //convert each shape into a list of transformed polygons
    let renderList = [];
    for (let shape of shapes) {
      if (shape.overallDepth !== undefined && shape.overallDepth.constructor !== Number) {
        shape.overallDepth = transformCamera.multiply(matrix.from([[shape.overallDepth[0]-camPos[0]], [shape.overallDepth[1]-camPos[1]], [shape.overallDepth[2]-camPos[2]]])).list[2][0];
      }
      for (let poly of (shape.rotatedPolys === null ? shape.polys : shape.rotatedPolys)) {
        let pts = poly.map(pt => [[pt[0]], [pt[1]], [pt[2]]]);
        pts.forEach((pt, idx) => pt.coords = poly[idx].coords);
        pts.forEach((pt, idx) => pt.vtn = poly[idx].vtn);
        let cross = poly.cross; if (shape.viewmodel&& !shape.still3d) cross = unit(plus(times(vecFromAngle(camAngle), .4), cross));
        let dot = dotProduct(cross, unit(lightingVector));

        let cameraDot = dotProduct(cross, unit([pts[1][0]-camPos[0], pts[1][1]-camPos[1], pts[1][2]-camPos[2]]));
        if (!shape.viewmodel || shape.still3d) {
          pts = pts.map(pt => {
            let transformed = shape.skybox ? transformCamera.multiply(matrix.from([[pt[0]-camPos[0]*skyboxParallax], [pt[1]-camPos[1]*skyboxParallax], [pt[2]-camPos[2]*skyboxParallax]])).list : transformCamera.multiply(matrix.from([[pt[0]-camPos[0]], [pt[1]-camPos[1]], [pt[2]-camPos[2]]])).list;
            transformed.coords = pt.coords;
            transformed.vtn = pt.vtn;
            return transformed;
          });
        }
        
        //clip polygons that pass partially behind the camera
        if (pts.some(pt => pt[2] < 0)) {
          pts = pts.map(pt => {let newpt = pt.map(arr=>arr[0]); newpt.coords = pt.coords; newpt.vtn = pt.vtn; return newpt;});
          let usable = pts.filter(pt => pt[2] > 0);
          if (usable.length >= 1) {
            let threshold = .08;
            let idx = pts.indexOf(usable[0]);
            let newPts = [];
            
            while (pts[idx%pts.length][2] > 0) {
              newPts.push(pts[idx%pts.length]);
              idx++;
            }
            let [last, curr] = [mapWhilePreserve(pts[(idx-1)%pts.length], Number), mapWhilePreserve(pts[idx%pts.length], Number)];
            let ratio = (threshold-curr[2])/(last[2]-curr[2]);
            let newPt = [curr[0]+ratio*(last[0]-curr[0]),curr[1]+ratio*(last[1]-curr[1]),threshold];
            if (materials[poly.mtl]?.texture) newPt.coords = [curr.coords[0] + (last.coords[0]-curr.coords[0]) * ratio, curr.coords[1] + (last.coords[1]-curr.coords[1]) * ratio];
            if (curr.vtn !== undefined) newPt.vtn = plus(times(curr.vtn, 1-ratio), times(last.vtn, ratio));
            else newPt.vtn = curr.vtn;

            while (pts[idx%pts.length][2] <= 0) idx++;
            if (!newPts.includes(pts[idx%pts.length])) lastPt = pts[idx%pts.length];
            [last, curr] = [mapWhilePreserve(pts[(idx-1)%pts.length], Number), mapWhilePreserve(pts[idx%pts.length], Number)]
            ratio = (threshold-curr[2])/(last[2]-curr[2]);
            newPts.push(newPt);
            newPts.push([curr[0]+ratio*(last[0]-curr[0]),curr[1]+ratio*(last[1]-curr[1]),threshold]);
            if (materials[poly.mtl]?.texture) newPts.at(-1).coords = [curr.coords[0] + (last.coords[0]-curr.coords[0]) * ratio, curr.coords[1] + (last.coords[1]-curr.coords[1]) * ratio];
            if (curr.vtn !== undefined) newPts.at(-1).vtn = plus(times(curr.vtn, 1-ratio), times(last.vtn, ratio));
            else newPts.at(-1).vtn = curr.vtn;
            while (pts[idx%(pts.length)] != newPts[0]) {
              newPts.push(pts[idx%(pts.length)]);
              idx++;
            }
            pts = newPts.map(pt => {let newpt = pt.map(n => [n]); newpt.coords = pt.coords; newpt.vtn = pt.vtn;return newpt;});
          } else continue;
        }
        
        let centroid = center(pts);
        
        if ((!shape.viewmodel || shape.still3d)&& cameraDot > 0) dot = -dot;
        let rgb = null;
        if (poly.mtl in materials) rgb = materials[poly.mtl];
        else rgb = [128, 128, 128];
        if (shape.sphereShading) {pts.sphereShading = true; pts.mtl = rgb; pts.lighting = 1;}
        else if (!rgb.texture) rgb = rgb.map(n => n*getLighting(dot));
        else if (shape.skybox !== true) pts.lighting = getLighting(dot);
        else pts.lighting = 1;
        pts.mtl = rgb;
        pts.meanZ = Math.sqrt((centroid[0])**2+(centroid[1])**2+(centroid[2])**2);
        pts.viewmodel = shape.viewmodel === true;
        pts.overallDepth = shape.overallDepth;
        renderList.push(pts);
      }
    }

    if (keys["i"]) FOV = getNewFOV(FOV, FOV[0] * .95);
    if (keys["o"]) FOV = getNewFOV(FOV, Math.min(FOV[0] / .95, Math.PI*.95**3));

    //render each polygon
    renderList.sort((a, b) => b.meanZ-a.meanZ);
    var canvasData = ctx.createImageData(canvas.width, canvas.height);
    let depthBuffer = Object.create(null);
    let viewmodelBuffer = Object.create(null);
    for (let pts of renderList) {
      drawPoly(pts.map(pt => {let newPt = project(pt); newPt.coords = pt.coords; newPt.vtn = pt.vtn; newPt.depth = 1/pt[2][0]; if (pts.overallDepth !== undefined) newPt.depth = 1/pts.overallDepth; return newPt;}), canvasData, depthBuffer, pts.mtl, viewmodelBuffer, pts.viewmodel, pts.lighting);
    }
    //draw sky (solid color)
    for (let i = 0; i < canvasData.height; i++) {
      for (let j = 0; j < canvasData.width; j++) {
        let index = (j + i * canvas.width) * 4;
        if (depthBuffer[index] === undefined) {
          canvasData.data[index] = 135;
          canvasData.data[index+1] = 206;
          canvasData.data[index+2] = 235;
          canvasData.data[index+3] = 255;
        }  
      }
    }
    ctx.putImageData(canvasData, 0, 0);

    //UI elements including crosshair, ammo, and health
    let difference = performance.now()-lastTime;
    lastTime = performance.now();
    let fps = 1000/difference;
    if (showFPS) drawText(ctx, "FPS: " + Math.round(fps), canvas.width-114/canvasDivision, canvas.height-24/canvasDivision, 30/canvasDivision, "black", "left");
    drawText(ctx, "Score: " + score, 10/canvasDivision, 30/canvasDivision, 40/canvasDivision, "black", "left");

    if (won) {
      camAngle[0] += 0.02;
      drawText(ctx, "You scored in only " + score + " stroke" + (score === 1 ? "!" : "s!"), canvas.width/2, 100/canvasDivision, 70/canvasDivision, `rgb(${255*Math.cos(timer/5)}, ${255*Math.sin(timer/5*1.5)}, ${255*Math.cos(timer/5*1.2)})`, "center", "Arial");
      let btns = Button.buttons.filter(btn => btn.props.targetScreen === "playing");
      for (let btn of btns) {
        if ((btn !== nextLevel || levelTemplates.indexOf(currentLevel) < (levelTemplates.length - 1))) {
          btn.draw();
          if (btn.isHovering(mouseX, mouseY) && mouseDown ) {
            btn.props.event();
          }
        }
      }
    }
    
    //check if we fell off the map
    if (player.offset[1] < fallingThresholds[0]) {
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(Math.max(0, (fallingThresholds[0]-player.offset[1])/(fallingThresholds[0]-fallingThresholds[1])), 1)}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (player.offset[1] < fallingThresholds[1]) resetValues();
    }
    //maintain a specific framerate by changing resolution
    if (fps < frameBounds[0]) canvasDivision += 0.25;
    if (fps > frameBounds[1] && canvasDivision >= 1.25) canvasDivision -= 0.25;
  }
  if (gameState === "paused") {
    //if mouse down while paused, resume
    if (mouseDown) {
      (async function() {
        await canvas.requestPointerLock();
        document.addEventListener("pointerlockchange", function start() {
          gameState = "playing";
          mouseDown = dragging;
          document.removeEventListener("pointerlockchange", start);
        });
      })();
    }
  }
  if (gameState === "justPaused") {
    //pause screen
    document.exitPointerLock();
    mouseDown = false;
    gameState = "paused";
    ctx.fillStyle = "rgba(175, 175, 175, 0.8)";
    ctx.beginPath();
    ctx.roundRect(canvas.width/2-300/canvasDivision, canvas.height/2-200/canvasDivision, 600/canvasDivision, 215/canvasDivision, 5);
    ctx.fill();
    drawText(ctx, "Paused!", canvas.width/2, canvas.height/2-140/canvasDivision, 60/canvasDivision, "black", "center", "Helvetica");
    drawText(ctx, "Click anywhere to resume", canvas.width/2, canvas.height/2-80/canvasDivision, 40/canvasDivision, "black", "center", "Helvetica");
    drawText(ctx, "Press 'm' to return to the menu", canvas.width/2, canvas.height/2-30/canvasDivision, 40/canvasDivision, "black", "center", "Helvetica");
  }
  if ((gameState === "playing" || gameState === "paused") && keys["m"]) {
    //return to menu if m is pressed
    gameState = "menu";
    document.exitPointerLock();
  }
  if (gameState === "menu" || gameState === "credits" || gameState === "instructions" || gameState === "levels") {
    //draw and handle buttons
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvasDivision = 1;
    clear(canvas);
    ctx.fillStyle = "lightblue";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (gameState === "menu") {
      let [width, height] = [getComputedStyle(canvas).width.replace("px", ""), getComputedStyle(canvas).height.replace("px", "")].map(Number);
      ctx.drawImage(thumbnail, width/2-(mouseX+width-50)/2-25, height/2 - (height+50)/2-(mouseY-50)/2, width+50, height+50);
      ctx.drawImage(logo, canvas.width/2-logo.width*.5, 30, logo.width, logo.height);
    }
    let hitButton = false;
    let clickableButtons = Button.buttons.filter(btn => btn.visible && btn.props.targetScreen === gameState);
    for (let button of clickableButtons) {
      button.draw();
      if (mouseDown && button.isHovering(mouseX, mouseY)) {
        button.props.event();
        hitButton = true;
        mouseDown = false;
      }
    }
    if (!hitButton) mouseDown = false;
  }
  
  if (gameState === "credits") {
    drawText(ctx, "Credits", canvas.width/2, 30, 40, "black", "center", "Helvetica");
    drawText(ctx, "Valley Terrain by Zsky [CC-BY] (https://creativecommons.org/licenses/by/3.0/)", canvas.width/2, 70, 20, "black", "center", "Trebuchet MS");
    drawText(ctx, "via Poly Pizza (https://poly.pizza/m/u78ByZHYB2); modified", canvas.width/2, 95, 20, "black", "center", "Trebuchet MS");
    drawText(ctx, "Sky Box - Sunny Day by Chad Wolfe licensed CC-BY 3.0, CC-BY-SA 3.0, GPL 3.0, GPL 2.0, OGA-BY 3.0"
, canvas.width/2, 120, 20, "black", "center", "Trebuchet MS")
    drawText(ctx, "via Open Game Art (https://opengameart.org/content/sky-box-sunny-day)", canvas.width/2, 145, 20, "black", "center", "Trebuchet MS");
    drawText(ctx, "Skybox Texture mapping Panorama via PngWing (https://www.pngwing.com/en/free-png-kyycs)", canvas.width/2, 170, 20, "black", "center", "Trebuchet MS");
  }
  if (gameState === "instructions") {
    drawText(ctx, "Instructions", canvas.width/2, 30, 40, "black", "center", "Helvetica");
    drawText(ctx, "Use mouse to aim camera, drag mouse to power up a shot, \"r\" to restart the level", canvas.width/2, 70, 20, "black", "center", "Trebuchet MS");
  }
  if (gameState === "levels") {
    drawText(ctx, "Level Select", canvas.width/2, 30, 40, "black", "center", "Helvetica");
  }
}, 50);

//mouse movement and events
canvas.addEventListener("mousemove", function(e) {
  if (gameState === "playing" && document.pointerLockElement !== null) {
    let factor = FOV[0] / trueFOV[0];
    if (!dragging) camAngle[0] += e.movementX/200 * factor;
    if (!dragging) camAngle[1] = Math.max(Math.min(camAngle[1]-e.movementY/200*factor, Math.PI/2-camMinimum), -Math.PI/2);
    mouseMovement = [e.movementX/200, e.movementY/200];
  } else {
    let bd = canvas.getBoundingClientRect();
    let mousePos = [(e.clientX - bd.left)*canvas.width/Number(getComputedStyle(canvas).width.replace("px", "")), (e.clientY - bd.top)*canvas.height/Number(getComputedStyle(canvas).height.replace("px", ""))];
    mouseX = mousePos[0]/canvas.width*100; mouseY = mousePos[1]/canvas.height*100;
  }
});
document.addEventListener("pointerlockerror", function(e) {
  console.log(e);
});
canvas.addEventListener("mousedown", function(e) {
  if (e.button !== 0) {
    e.preventDefault(); e.stopPropagation();
    if (e.button === 2) {
      rightMouseDown = true;
    }return;
  }
  mouseDown = true;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("mouseup", function(e) {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) rightMouseDown = false;
});

//menu buttons
class Button {
	static buttons = [];
	constructor(left, top, width, height, fill, text, targetScreen, event=function(){}) {
		this.props = {left, top, width, height, fill, text, targetScreen, event};
		Button.buttons.push(this);
		this.visible = true;
	}
	isHovering(x, y) {
		return this.visible && x >= this.props.left && x <= this.props.left + this.props.width && y >= this.props.top && y <= this.props.top + this.props.height;
	}
	draw() {
		ctx.beginPath();
		ctx.fillStyle = this.isHovering(mouseX, mouseY) ? "grey" : this.props.fill;
		ctx.roundRect(this.props.left*canvas.width/100, this.props.top*canvas.height/100, this.props.width*canvas.width/100, this.props.height*canvas.height/100, 3);
		ctx.fill();
		ctx.textAlign = "center";
		ctx.textBaseline = 'middle';
		drawText(ctx, this.props.text.value, (this.props.left+this.props.width/2)*canvas.width/100, 
      (this.props.top+this.props.height/2)*canvas.height/100, this.props.text.size/canvasDivision, "black", "center", this.props.text.font);
		ctx.textBaseline = 'alphabetic';
		if (this.isHovering(mouseX, mouseY)) canvas.style.cursor = ("pointer");
	}
}
let play = new Button(33, 68.5, 15, 10, "rgb(150, 150, 150)", {value:"Levels", font:"Courier, monospace", size:20}, "menu", function() {
  gameState = "levels";
});
let ogMiniGolf = new Button(52, 68.5, 15, 10, "rgb(150, 150, 150)", {value:"OG Minigolf", font:"Courier, monospace", size:20}, "menu", function() {
  let link = document.createElement("a");
  link.href = "https://academy.cs.cmu.edu/sharing/blackSeal3688";
  link.target = "_blank";
  link.click();
});
let credits = new Button(52, 85, 15, 10, "rgb(150, 150, 150)", {value:"Credits", font:"Courier, monospace", size:20}, "menu", function() {
  gameState = "credits";
});
let instructions = new Button(33, 85, 15, 10, "rgb(150, 150, 150)", {value:"Instructions", font:"Courier, monospace", size:20}, "menu", function() {
  gameState = "instructions";
});
let github = new Button(87, 88, 12, 10, "rgb(150, 150, 150)", {value:"Github", font:"Courier, monospace", size:20}, "menu", function() {
  let link = document.createElement("a");
  link.href = "https://github.com/gosoccerboy5/minigolf";
  link.target = "_blank";
  link.click();
});
let entryBreach = new Button(1, 88, 12, 10, "rgb(150, 150, 150)", {value:"Entry Breach", font:"Courier, monospace", size:20}, "menu", function() {
  let link = document.createElement("a");
  link.href = "https://gosoccerboy5.github.io/entry-breach/";
  link.target = "_blank";
  link.click();
});
let backhome = new Button(42.5, 70, 15, 10, "rgb(150, 150, 150)", {value:"Home", font:"Courier, monospace", size:20}, "credits", function() {
  gameState = "menu";
});
let backhome2 = new Button(42.5, 70, 15, 10, "rgb(150, 150, 150)", {value:"Home", font:"Courier, monospace", size:20}, "instructions", function() {
  gameState = "menu";
});
let backhome3 = new Button(42.5, 85, 15, 10, "rgb(150, 150, 150)", {value:"Home", font:"Courier, monospace", size:20}, "levels", function() {
  gameState = "menu";
});
let backhome4 = new Button(60, 60, 15, 10, "rgb(150, 150, 150)", {value:"Home", font:"Courier, monospace", size:50}, "playing", function() {
  gameState = "menu";
});
let restartLevel = new Button(25, 60, 15, 10, "rgb(150, 150, 150)", {value:"Restart", font:"Courier, monospace", size:40}, "playing", function() {
  document.addEventListener("pointerlockchange", function start() {
    if (document.pointerLockElement === canvas) {
      resetValues();
      gameState = "playing";
      mouseDown = false;
      document.removeEventListener("pointerlockchange", start);
    }
  });
  canvas.requestPointerLock();  
});
let nextLevel = new Button(42.5, 70, 15, 10, "rgb(150, 150, 150)", {value:"Next", font:"Courier, monospace", size:50}, "playing", function() {
  document.addEventListener("pointerlockchange", function start() {
    if (document.pointerLockElement === canvas) {
      currentLevel = levelTemplates[levelTemplates.indexOf(currentLevel)+1];
      resetValues();
      gameState = "playing";
      mouseDown = false;
      document.removeEventListener("pointerlockchange", start);
    }
  });
  canvas.requestPointerLock();  
  mouseDown = false;
});
let level1Button = new Button(20, 30, 15, 10, "rgb(150, 150, 150)", {value: "Level 1", font: "Courier, monospace", size:20}, "levels", null);
let level2Button = new Button(42.5, 30, 15, 10, "rgb(150, 150, 150)", {value: "Level 2", font: "Courier, monospace", size:20}, "levels", null);
let level3Button = new Button(65, 30, 15, 10, "rgb(150, 150, 150)", {value: "Level 3", font: "Courier, monospace", size:20}, "levels", null);

let levelButtons = [level1Button, level2Button, level3Button];
for (let btn of levelButtons) {
  btn.props.event = function() {
    if (!isLoading && levelTemplates[levelButtons.indexOf(btn)] !== undefined) {
      document.addEventListener("pointerlockchange", function start() {
        if (document.pointerLockElement === canvas) {
          currentLevel = levelTemplates[levelButtons.indexOf(btn)];
          resetValues();
          canvasDivision = 5;
          gameState = "playing";
          mouseDown = false;
          document.removeEventListener("pointerlockchange", start);
        }
      })
      canvas.requestPointerLock();    
    }
  };
}

let thumbnail = new Image();
thumbnail.src = "assets/thumbnail.png";
let logo = new Image();
logo.src = "assets/logo.png";

function loadImagePixels(image) {
  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  let imageData = ctx.getImageData(0, 0, image.width, image.height);
  let imgBuffer = [];
  for (let y = 0; y < imageData.height; y++) {
    let newBufferLine = [];
    for (let x = 0; x < imageData.width; x++) {
      let coord = (x + y * imageData.width) * 4;
      newBufferLine.push([imageData.data[coord], imageData.data[coord+1], imageData.data[coord+2]]);
    }
    imgBuffer.push(newBufferLine);
  }
  return imgBuffer;
}

function drawText(ctx, text, x, y, size=10, color="black", align="center", font="Arial") {
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  ctx.font = size + "px " + font;
  ctx.fillText(text, x, y);
}

//unused obj file loader
let fileInput = document.querySelector("input[type=file]");
if (fileInput !== null) {
  fileInput.addEventListener("input", async function(e) {
    let fileType = this.files[0].name.match(/\.(\w+)$/)[1];
    let reader = new FileReader();
    reader.readAsText(this.files[0])
    reader.onload = () => {
      if (fileType === "obj") shapes.push(processObj(reader.result));
      else if (fileType === "mtl") processMtl(reader.result);
    }
  });
}
//create a clone of a shape that is not tied to the old one
function copyShape(shape) {
  let newShape = new Shape([]);
  for (let poly of shape.polys) {
    let newPoly = poly.map(pt => pt.map(n=>n));
    newPoly.mtl = poly.mtl;
    newPoly.forEach((pt, idx) => pt.coords = poly[idx].coords);
    newShape.polys.push(newPoly);
  }
  newShape.updateCrossProducts();
  if (shape.sphereShading) newShape.updateVertexNormals();
  newShape.skybox = shape.skybox;
  newShape.sphereShading = shape.sphereShading;
  return newShape;
}

//parsing obj and mtl files to create objects
function processObj(text) {
  let vertices = text.match(/\nv (.+?) (.+?) (.+)/g);
  vertices = vertices.map(vertex => vertex.match(/ ([-\.\d]+)/g).map(Number));
  let uvCoords = text.match(/\nvt (.+?) (.+)/g);
  if (uvCoords !== null) uvCoords = uvCoords.map(uv => uv.match(/ ([-\.\d]+)/g).map(Number));
  let vtns = text.match(/\nvn (.+?) (.+?) (.+)/g);
  if (vtns !== null) vtns = vtns.map(vtn => vtn.match(/ ([-\.\d]+)/g).map(Number));
  let shape = new Shape([]);
  let materialSections = text.match(/(usemtl .+)(\n|\r)+((?!usemtl).+?(\n|\r)?)+/g) || [text];
  for (let materialSection of materialSections) {
    let mtl = materialSection.match(/usemtl (.+)(\n|\r)/)?.[1];
    let polys = materialSection.match(/(\n|\r)f (\d+\/\d*\/\d+ ?)+/g);

    for (let poly of polys) {
      let pts = poly.match(/ \d+/g).map(pt => vertices[Number(pt)-1].map(n=>n));
      if (uvCoords !== null) {
        let coords = [...poly.matchAll(/ \d+\/(\d+)\//g)].map(n => uvCoords[Number(n[1])-1].map(n=>n));
        for (let i = 0; i < pts.length; i++) {
          pts[i].coords = coords[i];
        }
      }
      pts.mtl = mtl;
      shape.polys.push(pts);
    }
  }
  
  shape.offset = center(shape.polys.map(center));
  shape.updateCrossProducts();
  return shape;
}
let materials = {};
function processMtl(text) {
  let mtls = text.match(/[\n^]*newmtl ((.+)\n)+/g);
  for (let material of mtls) {
    let name = material.match(/[\n^] *newmtl (.+)\n/)[1];
    let color = material.match(/\n *Kd ((\d\.?\d*[ \n]){3})/)[1].split(" ").map(n=>256*Number(n));
    materials[name] = color;
    if (/\nmap_Kd/.test(material)) {
      let imageFile = material.match(/\nmap_Kd (.+)\n/)[1];
      
      let texture = new Image();
      texture.src = "assets/" + imageFile;
      texture.onload = function(event) {
        materials[name] = loadImagePixels(this);
        materials[name].texture = true;
      }
    }
  }
}


let keys = {};
let mouseDown = false, rightMouseDown = false;
let mouseX = 0, mouseY = 0;
function deShift(key) {
  if ("!@#$%^&*()".includes(key)) {
    return "1234567890"["!@#$%^&*()".indexOf(key)];
  }
  return key;
}
document.addEventListener("keydown", function(e) {
	keys[deShift(e.key.toLowerCase())] = true;
});
document.addEventListener("keyup", function(e) {
	delete keys[deShift(e.key.toLowerCase())];
});

//load all objects and materials
["player", "testmap2", "testmap3", "skybox"].forEach(name => {
  fetch("assets/" + name + ".mtl").then(res => res.text()).then(mtl => {
    processMtl(mtl);
  });
});

let playerTemplate = null, skyboxTemplate = null, levelTemplates = [null, null, null];
Object.defineProperty(window, "isLoading", {
  get() {return [playerTemplate, skyboxTemplate].some(template => template === null);},
});

fetch("assets/player.obj").then(res => res.text()).then(obj => {
  playerTemplate = processObj(obj);
  playerTemplate.sphereShading = true;
});
fetch("assets/testmap2.obj").then(res => res.text()).then(obj => {
  levelTemplates[0] = processObj(obj);
});
fetch("assets/testmap3.obj").then(res => res.text()).then(obj => {
  levelTemplates[1] = processObj(obj);
});
fetch("assets/testmap4.obj").then(res => res.text()).then(obj => {
  levelTemplates[2] = processObj(obj);
});
fetch("assets/skybox.obj").then(res => res.text()).then(obj => {
  skyboxTemplate = processObj(obj);
  skyboxTemplate.skybox = true;
});
