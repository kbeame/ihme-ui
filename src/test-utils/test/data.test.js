import { expect } from 'chai';
import { isNull } from 'lodash';

import { dataGenerator } from '../data';

describe('data', () => {
  it('generates an array of 200 objects', () => {
    expect(dataGenerator()).to.be.an('array')
      .with.length(200)
      .and.to.have.deep.property('[0]')
      .that.is.an('object')
      .with.keys('location_id', 'value', 'ub', 'lb');
  });

  it('passes custom props to each datum', () => {
    expect(dataGenerator({ unicorns: 'rainbows' }))
      .to.have.deep.property('[0]')
      .that.is.an('object')
      .with.property('unicorns', 'rainbows');
  });

  it('creates data that has null values', () => {
    const data = dataGenerator({ dataQuality: 'worst' });
    const hasNullValues = data.some((datum) => {
      return isNull(datum.value);
    });

    expect(hasNullValues).to.be.true;
  });

  it('generates dates for keyfield', () => {
    const length = 20;
    const startYear = 2016;
    const data = dataGenerator({
      keyField: 'year_id',
      useDates: true,
      length,
      startYear
    });

    expect(data)
      .to.have.length(20);

    expect(data)
      .to.have.deep.property('[0].year_id')
      .that.is.a('number')
      .that.equals(startYear - length + 1);

    expect(data)
      .to.have.deep.property('[19].year_id')
      .that.is.a('number')
      .that.equals(startYear);
  });

  it('creates ub > value > lb', () => {
    const data = dataGenerator({
      length: 20
    });
    data.forEach((datum) => {
      expect(datum.ub).to.be.above(datum.value);
      expect(datum.value).to.be.above(datum.lb);
    });
  });

  it('creates increasing data', () => {
    const data = dataGenerator({
      length: 20
    });
    expect(data[0].value).to.be.below(data[19].value);
  });

  it('creates decreasing data', () => {
    const data = dataGenerator({
      dataTrend: 'decreasing',
      length: 20
    });
    expect(data[0].value).to.be.above(data[19].value);
  });

  it('creates exponential growth data(increases)', () => {
    const data = dataGenerator({
      dataTrend: 'exponentialGrowth',
      length: 20
    });
    expect(data[0].value).to.be.below(data[19].value);
  });

  it('creates exponential decay data(decreases)', () => {
    const data = dataGenerator({
      dataTrend: 'exponentialDecay',
      length: 20
    });
    expect(data[0].value).to.be.above(data[19].value);
  });
});