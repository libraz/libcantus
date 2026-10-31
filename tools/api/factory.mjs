/**
 * The static method a class with a private constructor is built through: `of` when it has one,
 * else its first static method that is not a deserializer.
 */
export function factoryOf(cls) {
  const methods = cls.members.filter((m) => m.static && m.kind === 'method');
  const factory =
    methods.find((m) => m.name === 'of') ??
    methods.find((m) => m.name !== 'fromData' && m.name !== 'fromJSON');
  if (!factory) throw new Error(`${cls.id}: private constructor and no factory method`);
  return `${cls.id}.${factory.name}`;
}
