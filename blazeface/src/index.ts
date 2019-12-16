/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tfconv from '@tensorflow/tfjs-converter';
import * as tf from '@tensorflow/tfjs-core';

import {scaleBox} from './box';
import {BlazeFaceModel} from './face';

const BLAZEFACE_MODEL_URL =
    'https://storage.googleapis.com/learnjs-data/facemesh_staging/facedetector_tfjs/model.json';

/**
 * Load blazeface.
 *
 * @param maxFaces The maximum number of faces returned by the model.
 * @param inputWidth The width of the input image.
 * @param inputHeight The height of the input image.
 * @param iouThreshold The threshold for deciding whether boxes overlap too
 * much.
 * @param scoreThreshold The threshold for deciding when to remove boxes based
 * on score.
 */
export async function load({
  maxFaces = 10,
  inputWidth = 128,
  inputHeight = 128,
  iouThreshold = 0.3,
  scoreThreshold = 0.75
} = {}) {
  const faceMesh = new FaceMesh();
  await faceMesh.load(
      maxFaces, inputWidth, inputHeight, iouThreshold, scoreThreshold);
  return faceMesh;
}

// type FaceBoundingBox = [[number, number], [number, number]];

export class FaceMesh {
  private blazeface: BlazeFaceModel;

  async load(
      maxFaces: number, inputWidth: number, inputHeight: number,
      iouThreshold: number, scoreThreshold: number) {
    const blazeFaceModel = await this.loadFaceModel();

    this.blazeface = new BlazeFaceModel(
        blazeFaceModel, inputWidth, inputHeight, maxFaces, iouThreshold,
        scoreThreshold);
  }

  loadFaceModel(): Promise<tfconv.GraphModel> {
    return tfconv.loadGraphModel(BLAZEFACE_MODEL_URL);
  }

  /**
   * Returns an array of faces in an image.
   *
   * @param input The image to classify. Can be a tensor or a DOM element iamge,
   * video, or canvas.
   */
  async estimateFace(
      input: tf.Tensor3D|ImageData|HTMLVideoElement|HTMLImageElement|
      HTMLCanvasElement,
      returnTensors = false): Promise<any> {
    if (!(input instanceof tf.Tensor)) {
      input = tf.browser.fromPixels(input);
    }

    const startNumTensors = tf.memory().numTensors;

    const image = input.toFloat().expandDims(0) as tf.Tensor4D;
    const [prediction, scaleFactor] = await this.blazeface.getBoundingBoxes(
        image as tf.Tensor4D, returnTensors);

    image.dispose();

    console.log('num new tensors:', tf.memory().numTensors - startNumTensors);

    if (returnTensors) {
      return (prediction as any[]).map((d: any) => {
        const scaledBox = scaleBox(d.box, scaleFactor as tf.Tensor1D)
                              .startEndTensor.squeeze();

        return {
          topLeft: scaledBox.slice([0], [2]),
          bottomRight: scaledBox.slice([2], [2]),
          landmarks: d.landmarks.add(d.anchor).mul(scaleFactor),
          probability: d.probability
        };
      });
    }

    const faces =
        await Promise.all((prediction as any[]).map(async (d: any) => {
          const scaledBox = scaleBox(d.box, scaleFactor as [number, number])
                                .startEndTensor.squeeze();

          const [landmarkData, boxData, probabilityData] =
              await Promise.all([d.landmarks, scaledBox, d.probability].map(
                  async d => await d.array()));

          const anchor = d.anchor as [number, number];
          const scaledLandmarks = landmarkData.map(
              (landmark: [number, number]) => ([
                (landmark[0] + anchor[0]) *
                    (scaleFactor as [number, number])[0],
                (landmark[1] + anchor[1]) * (scaleFactor as [number, number])[1]
              ]));

          return {
            topLeft: (boxData as number[]).slice(0, 2),
            bottomRight: (boxData as number[]).slice(2),
            landmarks: scaledLandmarks,
            probability: probabilityData
          };
        }));

    return faces;
  }
}