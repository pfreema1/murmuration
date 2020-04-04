import * as THREE from 'three';
import glslify from 'glslify';
import GPUComputationRenderer from './utils/GPUComputationRenderer';
import birdFrag from '../shaders/birds/bird.frag';
import birdVert from '../shaders/birds/bird.vert';
import positionFrag from '../shaders/birds/position.frag';
import velocityFrag from '../shaders/birds/velocity.frag';

// texture width for simulation
var WIDTH = 32;
var BIRDS = WIDTH * WIDTH;

var BirdGeometry = function () {

    var triangles = BIRDS * 3;
    var points = triangles * 3;

    THREE.BufferGeometry.call(this);

    var vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
    var birdColors = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
    var references = new THREE.BufferAttribute(new Float32Array(points * 2), 2);
    var birdVertex = new THREE.BufferAttribute(new Float32Array(points), 1);

    this.setAttribute('position', vertices);
    this.setAttribute('birdColor', birdColors);
    this.setAttribute('reference', references);
    this.setAttribute('birdVertex', birdVertex);

    // this.setAttribute( 'normal', new Float32Array( points * 3 ), 3 );


    var v = 0;

    function verts_push() {

        for (var i = 0; i < arguments.length; i++) {

            vertices.array[v++] = arguments[i];

        }

    }

    var wingsSpan = 20;

    for (var f = 0; f < BIRDS; f++) {

        // Body
        verts_push(
            0, - 0, - 20,
            0, 4, - 20,
            0, 0, 30
        );

        // Left Wing
        verts_push(
            0, 0, - 15,
            - wingsSpan, 0, 0,
            0, 0, 15
        );

        // Right Wing
        verts_push(
            0, 0, 15,
            wingsSpan, 0, 0,
            0, 0, - 15
        );

    }

    for (var v = 0; v < triangles * 3; v++) {

        var i = ~ ~(v / 3);
        var x = (i % WIDTH) / WIDTH;
        var y = ~ ~(i / WIDTH) / WIDTH;

        var c = new THREE.Color(
            0x444444 +
            ~ ~(v / 9) / BIRDS * 0x666666
        );

        birdColors.array[v * 3 + 0] = c.r;
        birdColors.array[v * 3 + 1] = c.g;
        birdColors.array[v * 3 + 2] = c.b;

        references.array[v * 2] = x;
        references.array[v * 2 + 1] = y;

        birdVertex.array[v] = v % 9;

    }

    this.scale(0.2, 0.2, 0.2);

};

BirdGeometry.prototype = Object.create(THREE.BufferGeometry.prototype);


/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////


export default class Birds {
    constructor(bgScene, bgCamera, renderer) {
        this.bgScene = bgScene;
        this.bgCamera = bgCamera;
        this.renderer = renderer;

        this.windowHalfX = window.innerWidth / 2;
        this.windowHalfY = window.innerHeight / 2;

        this.BOUNDS = 800;
        this.BOUNDS_HALF = this.BOUNDS / 2;

        this.last = performance.now();

        this.gpuCompute = null;
        this.velocityVariable = null;
        this.positionVariable = null;
        this.positionUniforms = null;
        this.velocityUniforms = null;
        this.birdUniforms = null;
        this.mouseX = 0;
        this.mouseY = 0;

        this.init();
    }

    init() {
        this.initComputeRenderer();

        document.addEventListener('mousemove', this.onDocumentMouseMove, false);

        this.effectController = {
            separation: 20.0,
            alignment: 20.0,
            cohesion: 20.0,
            freedom: 0.75
        };

        this.velocityUniforms["separationDistance"].value = this.effectController.separation;
        this.velocityUniforms["alignmentDistance"].value = this.effectController.alignment;
        this.velocityUniforms["cohesionDistance"].value = this.effectController.cohesion;
        this.velocityUniforms["freedomFactor"].value = this.effectController.freedom;

        this.initBirds();
    }

    initComputeRenderer() {
        this.gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, this.renderer);
        this.dtPosition = this.gpuCompute.createTexture();
        this.dtVelocity = this.gpuCompute.createTexture();

        this.fillPositionTexture(this.dtPosition);
        this.fillVelocityTexture(this.dtVelocity);

        this.velocityVariable = this.gpuCompute.addVariable('textureVelocity', velocityFrag, this.dtVelocity);
        this.positionVariable = this.gpuCompute.addVariable('texturePosition', positionFrag, this.dtPosition);

        this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);
        this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);

        this.positionUniforms = this.positionVariable.material.uniforms;
        this.velocityUniforms = this.velocityVariable.material.uniforms;

        this.positionUniforms["time"] = { value: 0.0 };
        this.positionUniforms["delta"] = { value: 0.0 };
        this.velocityUniforms["time"] = { value: 1.0 };
        this.velocityUniforms["delta"] = { value: 0.0 };
        this.velocityUniforms["testing"] = { value: 1.0 };
        this.velocityUniforms["separationDistance"] = { value: 1.0 };
        this.velocityUniforms["alignmentDistance"] = { value: 1.0 };
        this.velocityUniforms["cohesionDistance"] = { value: 1.0 };
        this.velocityUniforms["freedomFactor"] = { value: 1.0 };
        this.velocityUniforms["predator"] = { value: new THREE.Vector3() };
        this.velocityVariable.material.defines.BOUNDS = this.BOUNDS.toFixed(2);

        this.velocityVariable.wrapS = THREE.RepeatWrapping;
        this.velocityVariable.wrapT = THREE.RepeatWrapping;
        this.positionVariable.wrapS = THREE.RepeatWrapping;
        this.positionVariable.wrapT = THREE.RepeatWrapping;

        const error = this.gpuCompute.init();
        if (error !== null) {
            console.error(error);
        }

    }

    initBirds() {
        this.geometry = new BirdGeometry();

        this.birdUniforms = {
            "color": { value: new THREE.Color(0xff2200) },
            "texturePosition": { value: null },
            "textureVelocity": { value: null },
            "time": { value: 1.0 },
            "delta": { value: 0.0 }
        };

        this.material = new THREE.ShaderMaterial({
            uniforms: this.birdUniforms,
            vertexShader: birdVert,
            fragmentShader: birdFrag,
            side: THREE.DoubleSide
        });

        this.birdMesh = new THREE.Mesh(this.geometry, this.material);
        this.birdMesh.rotation.y = Math.PI / 2;
        this.birdMesh.matrixAutoUpdate = false;
        this.birdMesh.updateMatrix();

        this.bgScene.add(this.birdMesh);
    }

    fillPositionTexture(texture) {
        var theArray = texture.image.data;

        for (var k = 0, kl = theArray.length; k < kl; k += 4) {

            var x = Math.random() * this.BOUNDS - this.BOUNDS_HALF;
            var y = Math.random() * this.BOUNDS - this.BOUNDS_HALF;
            var z = Math.random() * this.BOUNDS - this.BOUNDS_HALF;

            theArray[k + 0] = x;
            theArray[k + 1] = y;
            theArray[k + 2] = z;
            theArray[k + 3] = 1;

        }
    }

    fillVelocityTexture(texture) {
        var theArray = texture.image.data;

        for (var k = 0, kl = theArray.length; k < kl; k += 4) {

            var x = Math.random() - 0.5;
            var y = Math.random() - 0.5;
            var z = Math.random() - 0.5;

            theArray[k + 0] = x * 10;
            theArray[k + 1] = y * 10;
            theArray[k + 2] = z * 10;
            theArray[k + 3] = 1;

        }
    }

    onDocumentMouseMove(event) {
        this.mouseX = event.clientX - this.windowHalfX;
        this.mouseY = event.clientY - this.windowHalfY;
    }

    update() {
        this.now = performance.now();
        this.delta = (this.now - this.last) / 1000;

        if (this.delta > 1) this.delta = 1; // safety cap on large deltas
        this.last = this.now;

        this.positionUniforms["time"].value = this.now;
        this.positionUniforms["delta"].value = this.delta;
        this.velocityUniforms["time"].value = this.now;
        this.velocityUniforms["delta"].value = this.delta;
        this.birdUniforms["time"].value = this.now;
        this.birdUniforms["delta"].value = this.delta;

        this.velocityUniforms["predator"].value.set(0.5 * this.mouseX / this.windowHalfX, - 0.5 * this.mouseY / this.windowHalfY, 0);

        this.mouseX = 10000;
        this.mouseY = 10000;

        this.gpuCompute.compute();

        this.birdUniforms["texturePosition"].value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
        this.birdUniforms["textureVelocity"].value = this.gpuCompute.getCurrentRenderTarget(this.velocityVariable).texture;
    }
}