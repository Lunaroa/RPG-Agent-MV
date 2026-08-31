/**
 * Normalized SHA-256 digests of first-party MZUIRuntime sources committed
 * before project runtime manifests were introduced. Exact matching lets an
 * existing project migrate without treating a previously installed runtime as
 * a user modification. New installations are tracked by the project manifest
 * instead of extending this compatibility list.
 */
const LEGACY_MANAGED_RUNTIME_DIGESTS = new Set([
  'bf3b1315dab0d498c9f30e3628d3838636d7c3310e4aaeb49ad9559a68a2cdfc',
  '2ad0aac562fef5f26da8f8b20af76dfb6dc0a6763e396dce64f59c93b8777923',
  '091656206423e7753e43e848a15040b260dd0ed6e292094b946704a65746b04e',
  'c0c07687e9dafbe67638589b2ece980f7c57825693c335009a3a16f594239443',
  '58cc7d6b465b8c2fa0a827dd1a24244ff82a73bbd0476b50c0cafc38b297150f',
  'b53c9c4789bf36f05acd40d7bef6dceae3e02a4325a694680aefe9c747f163b8',
  '66c2375a6d98250d838924369e590fc0a9f08c1dd7a3a3729e79d448458ded80',
  'f43a8762cd249601c25dac11d756ff6b8baa669d0658a0b5aee4fc9e8b67ec4b',
  '314b5c514bba8489edf5046356ecebfde0b0763ee5521339519bec50db4ac67c',
  '94fca56216bfd2d4420440cfa20a30d65707760101ec36e77147ed76cd0c8b98',
  'f57f6a504bc0a3d05d32f477966b5c1e250c6aac017c920794316541ec22a78a',
  '4a328cea3ecdd0edda2806c567b15e532ed9a89a0f42aa6ea516447f4d718378',
  '72aba89a6369386c1dd2c627e229001e3b2e37fab1fc8204c7083616499bec7d',
  '3c051d926dd110e90931dff116b4bbe301fc35472ee64734ad12399e7f218d3c',
  'ca8d0ec2daa6fb6281d1cd0191133b3e57a868041df8480fd0b52bae63f2b2f3',
  'f6fd40a00aba064e3543072afd05c34698b223ecb3f4f4116a3f867597c1d6e1',
  'c9a0e8364e6af5339db92ae27aadc6fb1600a27a74334663492d085ce4423b7a',
  'a04f1f15300cae3e689b19f52707f6fd7637109760b9703b747f320cd72e8f31',
  '59f1ab79cb01928bac09dea102f168d9e4ed92fd1aaec4b054acffa9c10719d9',
  '2fe32926f545a27f1b9e6beb2c73dcd15e64667622e3d584c185a6af2cb08e11',
  '5715427e9ec4d89c71135d8d59a9dc8b61878d6ee801437ad3522feff8669620',
  '321875fc4acd23889b1b887e431c3a1eb01846f0eeeea63e7f612401bb1b7c5b',
  '05be476a07cbf0e5a63087e884d3a9cdf4914d7d2288303d613a8c2f67111295',
  '7d439d25f7c72b15e1c6649604bf101a1afaae266bdd5ae9400ebb0494c8da3a',
]);

export function isLegacyManagedUiDesignerRuntimeDigest(digest: string): boolean {
  return LEGACY_MANAGED_RUNTIME_DIGESTS.has(digest);
}
