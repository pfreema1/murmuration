precision highp float;
uniform sampler2D uScene;
uniform sampler2D uMouseCanvas;
uniform sampler2D uTextCanvas;
uniform vec2 uResolution;
uniform float uTime;

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    vec4 color = vec4(0.0);
    vec4 sceneColor = texture2D(uScene, uv);
    vec4 canvasTextureColor = texture2D(uMouseCanvas, uv);
    vec4 textCanvasColor = texture2D(uTextCanvas, uv);


    color = sceneColor;

    
    gl_FragColor = vec4(color);
}