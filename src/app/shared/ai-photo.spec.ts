import { AI_PHOTO_LABEL, isAiGeneratedPhoto, withAiBadge } from './ai-photo';

describe('ai-photo', () => {
  it('labels a bundled AI demo face', () => {
    expect(isAiGeneratedPhoto('cert1.jpg')).toBeTrue();
  });

  it('never labels a photo stored on the device, even for a demo ranger', () => {
    expect(isAiGeneratedPhoto('cert1.jpg', true)).toBeFalse();
  });

  it('does not label the non-AI demo image or a user\'s own file', () => {
    expect(isAiGeneratedPhoto('badge-cmd.svg')).toBeFalse();
    expect(isAiGeneratedPhoto('my-team.jpg')).toBeFalse();
    expect(isAiGeneratedPhoto(undefined)).toBeFalse();
  });

  it('adds the badge only when asked', () => {
    expect(withAiBadge('<img>', false)).toBe('<img>');
    const html = withAiBadge('<img>', true);
    expect(html).toContain('rt-ai-badge');
    expect(html).toContain(AI_PHOTO_LABEL);
  });
});
