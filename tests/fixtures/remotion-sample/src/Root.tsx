import { Composition } from 'remotion';
import { FPS } from './constants';
import { Video } from './Video';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LaunchVideo"
        component={Video}
        durationInFrames={9 * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ title: 'Ship videos faster', speed: 2 }}
      />
      <Composition id="LaunchSquare" component={Video} durationInFrames={150} fps={FPS} width={1080} height={1080} calculateMetadata={() => ({ props: {} })} />
    </>
  );
};
